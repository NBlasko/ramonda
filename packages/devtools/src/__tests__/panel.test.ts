import { beforeEach, describe, expect, it, vi } from "vitest";
import "../index";

/**
 * The panel, driven the way an app drives it: a tree published on `window`, a tab clicked, and
 * the shadow DOM read back.
 *
 * Every case here is a bug that shipped. The pinned view rebuilding on every tick, an attribute
 * that was never escaped so both Query buttons were dead, a filter that had to survive a
 * structural re-render — all of them are DOM facts, and all of them were found by hand.
 */

interface Node {
  name: string;
  kind: "component" | "hook";
  state: Record<string, unknown>;
  props?: Record<string, unknown>;
  options?: Record<string, unknown>;
  hooks: Node[];
  children: Node[];
  node?: unknown;
}

const node = (name: string, kind: "component" | "hook", extra: Partial<Node> = {}): Node => ({
  name,
  kind,
  state: {},
  hooks: [],
  children: [],
  ...extra,
});

/** App › ProductsPage (+ a Query hook) › ProductDetail — the playground's shape, trimmed. */
function tree(withDetail = true): Node[] {
  const detail = node("ProductDetail", "component", {
    props: { id: 3 },
    state: { open: true },
  });
  const page = node("ProductsPage", "component", {
    state: { selected: 3 },
    hooks: [node("Query", "hook", { options: { key: '["products"]' } })],
    children: withDetail ? [detail] : [],
  });
  return [node("App", "component", { children: [page] })];
}

type Panel = HTMLElement & { shadowRoot: ShadowRoot };

function mount(inspect: () => Node[]): Panel {
  document.body.innerHTML = "";
  (window as unknown as { __RAMONDA_INSPECT__: unknown }).__RAMONDA_INSPECT__ = inspect;

  const panel = document.createElement("ramonda-devtools") as Panel;
  document.body.append(panel);
  panel.setAttribute("open", "");
  openTab(panel, "components");
  return panel;
}

function openTab(panel: Panel, name: string): void {
  panel.shadowRoot.querySelector(`.tab[data-tab="${name}"]`)!.dispatchEvent(new Event("click"));
}

const summaries = (panel: Panel): string[] =>
  Array.from(panel.shadowRoot.querySelectorAll(".comp-summary")).map((s) => s.getAttribute("data-path")!);

const crumbs = (panel: Panel): string[] =>
  Array.from(panel.shadowRoot.querySelectorAll("#crumbs .crumb")).map((c) => c.textContent!.trim());

/** Clicks the focus button of the row whose path ends in `name`. */
function focus(panel: Panel, name: string): void {
  const button = Array.from(panel.shadowRoot.querySelectorAll("[data-pin]")).find((b) =>
    (b as HTMLElement).dataset.pin!.endsWith(`:${name}`),
  );
  if (!button) throw new Error(`no focus button for ${name}`);
  button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  document.body.innerHTML = "";
  // The dock/float preference is persisted, so a test that changes it would leak into the next.
  localStorage.clear();
  /**
   * The app's own margin, and every layout assertion is written against it.
   *
   * jsdom has no layout, so a docked panel writes `0px` — which is indistinguishable from "not
   * docked" if the body starts empty. Starting at 17px makes the two states tell each other apart:
   * docking overwrites it, floating leaves it exactly alone.
   */
  document.body.style.marginRight = "17px";
});

describe("the component tree", () => {
  it("renders every component and hook once", () => {
    const panel = mount(() => tree());

    expect(summaries(panel)).toEqual([
      "/0:component:App",
      "/0:component:App/0:component:ProductsPage",
      "/0:component:App/0:component:ProductsPage|h/0:hook:Query",
      "/0:component:App/0:component:ProductsPage/0:component:ProductDetail",
    ]);
  });
});

describe("focusing one component", () => {
  it("leaves only that subtree, under a breadcrumb of its ancestry", () => {
    const panel = mount(() => tree());
    focus(panel, "ProductDetail");

    expect(summaries(panel)).toEqual(["/0:component:App/0:component:ProductsPage/0:component:ProductDetail"]);
    expect(crumbs(panel)).toEqual(["all components", "<App />", "<ProductsPage />", "<ProductDetail />"]);
  });

  /**
   * The path is the pin, so it has to come out of a subtree render byte-identical to the
   * full-tree one — that is what `walkTree`'s index offset is for. Focus twice: if the path
   * moved, the second click could not find the same node.
   */
  it("keeps the path a component had in the whole tree", () => {
    const panel = mount(() => tree());
    const before = summaries(panel);

    focus(panel, "Query");
    expect(summaries(panel)).toEqual(["/0:component:App/0:component:ProductsPage|h/0:hook:Query"]);
    expect(before).toContain(summaries(panel)[0]);

    focus(panel, "Query");
    expect(summaries(panel)).toEqual(["/0:component:App/0:component:ProductsPage|h/0:hook:Query"]);
  });

  /**
   * The regression this feature could most easily have caused. `refreshComponents` compares a
   * signature of the whole tree; if focusing narrowed that signature, it would differ on every
   * tick and the panel would rebuild itself four times a second — the flicker, back again.
   */
  it("does not rebuild on every tick", () => {
    const panel = mount(() => tree());
    const sig = (panel as unknown as { lastSig: string }).lastSig;

    focus(panel, "ProductDetail");
    expect((panel as unknown as { lastSig: string }).lastSig).toBe(sig);

    const pinnedRow = panel.shadowRoot.querySelector(".comp-summary")!;
    window.dispatchEvent(new CustomEvent("ramonda:tick"));

    // Same ELEMENT, not merely the same markup: a rebuild would replace it, losing the reader's
    // open/closed state, their selection and their scroll position.
    expect(panel.shadowRoot.querySelector(".comp-summary")).toBe(pinnedRow);
    expect(summaries(panel)).toHaveLength(1);
  });

  it("widens back to the whole tree from the breadcrumb", () => {
    const panel = mount(() => tree());
    focus(panel, "ProductDetail");

    panel.shadowRoot
      .querySelector('#crumbs [data-crumb=""]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(summaries(panel)).toHaveLength(4);
    expect(panel.shadowRoot.querySelector("#crumbs")!.classList.contains("on")).toBe(false);
  });

  it("widens one step when an ancestor crumb is clicked", () => {
    const panel = mount(() => tree());
    focus(panel, "ProductDetail");

    const ancestor = Array.from(panel.shadowRoot.querySelectorAll("#crumbs [data-crumb]")).find((c) =>
      (c as HTMLElement).dataset.crumb!.endsWith(":ProductsPage"),
    )!;
    ancestor.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(summaries(panel)).toEqual([
      "/0:component:App/0:component:ProductsPage",
      "/0:component:App/0:component:ProductsPage|h/0:hook:Query",
      "/0:component:App/0:component:ProductsPage/0:component:ProductDetail",
    ]);
  });

  it("says so when the focused component unmounts, and shows the tree again", () => {
    let mounted = true;
    const panel = mount(() => tree(mounted));
    focus(panel, "ProductDetail");

    mounted = false;
    window.dispatchEvent(new CustomEvent("ramonda:tick"));

    expect(panel.shadowRoot.querySelector("#crumbs")!.textContent).toContain("no longer mounted");
    expect(summaries(panel)).toEqual([
      "/0:component:App",
      "/0:component:App/0:component:ProductsPage",
      "/0:component:App/0:component:ProductsPage|h/0:hook:Query",
    ]);
  });

  it("is released by Escape, and only while something is focused", () => {
    const panel = mount(() => tree());
    focus(panel, "ProductDetail");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(summaries(panel)).toHaveLength(4);

    // Nothing focused: the listener must not swallow the app's Escape.
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("the name filter", () => {
  const type = (panel: Panel, value: string) => {
    const input = panel.shadowRoot.querySelector("#tree-filter") as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event("input"));
  };

  const hits = (panel: Panel): string[] =>
    Array.from(panel.shadowRoot.querySelectorAll(".component-node.hit")).map(
      (n) => n.querySelector(".comp-summary")!.getAttribute("data-path")!,
    );

  it("marks the matching rows and nothing else", () => {
    const panel = mount(() => tree());
    type(panel, "detail");

    expect(panel.shadowRoot.querySelector("#components-container")!.classList.contains("filtering")).toBe(true);
    expect(hits(panel)).toEqual(["/0:component:App/0:component:ProductsPage/0:component:ProductDetail"]);
  });

  it("matches case-insensitively and can match several", () => {
    const panel = mount(() => tree());
    type(panel, "PRODUCT");

    expect(hits(panel)).toEqual([
      "/0:component:App/0:component:ProductsPage",
      "/0:component:App/0:component:ProductsPage/0:component:ProductDetail",
    ]);
  });

  it("opens collapsed branches, so a hit is never hidden inside one", () => {
    const panel = mount(() => tree());
    for (const details of Array.from(panel.shadowRoot.querySelectorAll("details"))) {
      (details as HTMLDetailsElement).open = false;
    }

    type(panel, "detail");

    expect(Array.from(panel.shadowRoot.querySelectorAll("details")).every((d) => (d as HTMLDetailsElement).open)).toBe(
      true,
    );
  });

  /**
   * The filter is held as a QUERY and re-applied, never read back off the DOM — so a structural
   * re-render (a component mounting, a route changing) cannot silently drop it.
   */
  it("survives a structural re-render", () => {
    let mounted = false;
    const panel = mount(() => tree(mounted));
    type(panel, "detail");
    expect(hits(panel)).toEqual([]);

    mounted = true;
    window.dispatchEvent(new CustomEvent("ramonda:tick"));

    expect(hits(panel)).toEqual(["/0:component:App/0:component:ProductsPage/0:component:ProductDetail"]);
  });

  it("clears back to the whole tree", () => {
    const panel = mount(() => tree());
    type(panel, "detail");
    type(panel, "");

    expect(panel.shadowRoot.querySelector("#components-container")!.classList.contains("filtering")).toBe(false);
    expect(hits(panel)).toEqual([]);
  });
});

describe("the Query tab", () => {
  const row = {
    key: ["products"],
    hash: '["products"]',
    status: "success",
    fetchStatus: "idle",
    observers: 1,
    updatedAt: 1,
    failureCount: 0,
    restored: true,
    dataPreview: '{"products":[]}',
    data: { products: [{ id: 1, title: "Mascara" }] },
  };

  function withBridge(rows: () => unknown[] = () => [row]): {
    panel: Panel;
    invalidate: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  } {
    const invalidate = vi.fn();
    const remove = vi.fn();
    (window as unknown as { __RAMONDA_QUERY__: unknown }).__RAMONDA_QUERY__ = {
      snapshot: () => ({ clients: [{ index: 0, queries: rows() }] }),
      invalidate,
      remove,
    };

    const panel = mount(() => tree());
    openTab(panel, "query");
    return { panel, invalidate, remove };
  }

  /**
   * The bug this locks: a hash is JSON, so it carries quotes, and `data-q-hash="["products"]"`
   * ends the attribute at the second one. `dataset.qHash` came back as `[`, the bridge looked up
   * an entry that cannot exist, and both buttons did nothing — silently, with no error anywhere.
   */
  it("round-trips a quoted key hash through the markup", () => {
    const { panel, invalidate, remove } = withBridge();

    const buttons = Array.from(panel.shadowRoot.querySelectorAll("[data-q-action]")) as HTMLElement[];
    expect(buttons.map((b) => b.dataset.qHash)).toEqual(['["products"]', '["products"]']);

    buttons[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(invalidate).toHaveBeenCalledWith(0, '["products"]');

    buttons[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(remove).toHaveBeenCalledWith(0, '["products"]');

    openTab(panel, "logs"); // stops the poll
  });

  /**
   * The same broken attribute is why the age element could not be found — and why the poll threw
   * `not a valid selector` four times a second once it was looked up by selector.
   */
  it("refreshes an age in place without building a selector from data", () => {
    const { panel } = withBridge();
    const container = panel.shadowRoot.querySelector("#query-container")!;
    const age = container.querySelector("[data-q-age]") as HTMLElement;

    expect(age.dataset.qAge).toBe('0:["products"]');

    const refresh = () => (panel as unknown as { renderQueries(): void }).renderQueries.call(panel);
    expect(refresh).not.toThrow();
    // The same element, updated in place: rebuilding the list is what made the tab flicker.
    expect(container.querySelector("[data-q-age]")).toBe(age);

    openTab(panel, "logs");
  });
});

describe("docking", () => {
  const layout = (panel: Panel) => (panel as unknown as { applyLayout(): void }).applyLayout();
  const toggle = (panel: Panel) => (panel as unknown as { toggle(): void }).toggle();
  const margin = () => document.body.style.marginRight;

  it("squeezes the page while open and puts the margin back on close", () => {
    const panel = mount(() => tree());

    // Opened by `mount` through the attribute, so apply the layout the way the badge does.
    layout(panel);
    expect(margin()).not.toBe("17px");
    expect(margin()).toMatch(/px$/);

    toggle(panel);
    expect(margin()).toBe("17px");
  });

  /**
   * The reason two layouts exist. The panel opens ITSELF on a dev error, and squeezing the page
   * then is destructive: the app reflows, a media query flips, and the layout you are shown is not
   * the one the error happened in. An error must not change the evidence.
   */
  it("does not reflow the app when it opens itself on an error", () => {
    const panel = mount(() => tree());
    toggle(panel); // start closed, at the app's own layout
    expect(margin()).toBe("17px");

    window.dispatchEvent(
      new CustomEvent("ramonda:dev-log", { detail: { type: "error", message: "RMD001", id: "1", timestamp: "t" } }),
    );

    expect(panel.hasAttribute("open")).toBe(true);
    expect(margin()).toBe("17px");
    expect(panel.classList.contains("floating")).toBe(true);
    // It says why, because the reader did not choose this layout.
    expect(panel.shadowRoot.querySelector(".mode-note")).not.toBe(null);
  });

  it("leaves a docked panel alone when a second error arrives", () => {
    const panel = mount(() => tree());
    layout(panel);
    const docked = margin();
    expect(docked).toBe("0px");

    window.dispatchEvent(
      new CustomEvent("ramonda:dev-log", { detail: { type: "error", message: "RMD001", id: "2", timestamp: "t" } }),
    );

    // Reflowing on the second error would destroy the layout being read.
    expect(margin()).toBe(docked);
    expect(panel.classList.contains("floating")).toBe(false);
  });

  it("docks on request, and remembers the choice", () => {
    const panel = mount(() => tree());
    toggle(panel);
    window.dispatchEvent(
      new CustomEvent("ramonda:dev-log", { detail: { type: "error", message: "RMD001", id: "3", timestamp: "t" } }),
    );
    expect(margin()).toBe("17px");

    panel.shadowRoot.querySelector("#mode-btn")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(margin()).toBe("0px");
    expect(panel.classList.contains("floating")).toBe(false);
    expect(localStorage.getItem("ramonda:devtools-mode")).toBe("dock");

    panel.shadowRoot.querySelector("#mode-btn")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(margin()).toBe("17px");
    expect(localStorage.getItem("ramonda:devtools-mode")).toBe("float");
  });

  it("honours a remembered float preference on a manual open", () => {
    localStorage.setItem("ramonda:devtools-mode", "float");
    const panel = mount(() => tree());
    layout(panel);

    expect(margin()).toBe("17px");
    expect(panel.classList.contains("floating")).toBe(true);
    // Not an error, so no explanation is owed.
    expect(panel.classList.contains("forced-float")).toBe(false);
  });
});

describe("picking a component from the page", () => {
  const start = (panel: Panel) => {
    panel.shadowRoot.querySelector('[data-tool="pick"]')!.dispatchEvent(new Event("click"));
  };
  const picking = (panel: Panel) => panel.classList.contains("picking");

  function withHosts(): { panel: Panel; page: HTMLElement; inner: HTMLElement } {
    const page = document.createElement("section");
    const inner = document.createElement("strong");
    page.append(inner);

    const detailNode = node("ProductDetail", "component", { props: { id: 3 }, node: page });
    const panel = mount(() => [
      node("App", "component", {
        children: [node("ProductsPage", "component", { children: [detailNode] })],
      }),
    ]);

    // AFTER mounting, because `mount` clears the body — and a detached element's events never
    // reach the `window` listener the picker captures on, so the test would be testing nothing.
    document.body.append(page);
    return { panel, page, inner };
  }

  it("names the component under the cursor, from a child element", () => {
    const { panel, inner } = withHosts();
    start(panel);
    expect(picking(panel)).toBe(true);

    inner.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));

    const label = panel.shadowRoot.querySelector("#pick-label")!;
    expect(label.classList.contains("on")).toBe(true);
    // The cursor was over a <strong> INSIDE the component's host: the nearest mapped ancestor is
    // the answer, because a component is almost never the element you point at.
    expect(label.textContent).toBe("<ProductDetail />");
  });

  it("focuses what was clicked, and stops picking", () => {
    const { panel, inner } = withHosts();
    start(panel);
    inner.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    inner.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(picking(panel)).toBe(false);
    expect(summaries(panel)).toEqual(["/0:component:App/0:component:ProductsPage/0:component:ProductDetail"]);
  });

  /**
   * The one that makes a picker usable at all. Ramonda attaches a handler to its element directly,
   * in the bubble phase, so picking captures on `window` and stops the event — otherwise a pick
   * would also submit the form or open the menu it was aimed at.
   */
  it("does not let the app see the click it picked with", () => {
    const { panel, page, inner } = withHosts();
    const clicked = vi.fn();
    page.addEventListener("click", clicked);

    start(panel);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    inner.dispatchEvent(event);

    expect(clicked).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("is cancelled by Escape, leaving the app's click alone again", () => {
    const { panel, page, inner } = withHosts();
    const clicked = vi.fn();
    page.addEventListener("click", clicked);

    start(panel);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(picking(panel)).toBe(false);

    inner.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("stops when the panel closes, so the page is not left with a crosshair", () => {
    const { panel } = withHosts();
    start(panel);
    expect(document.body.style.cursor).toBe("crosshair");

    (panel as unknown as { toggle(): void }).toggle();

    expect(picking(panel)).toBe(false);
    expect(document.body.style.cursor).toBe("");
  });
});

describe("values as trees", () => {
  const treeText = (panel: Panel, index = 0) =>
    Array.from(panel.shadowRoot.querySelectorAll(".sv"))[index]!.textContent!;

  it("labels a container by its size instead of printing it", () => {
    const panel = mount(() => [
      node("App", "component", {
        state: { feed: { pages: [{ products: [{ id: 1, title: "Mascara" }] }], total: 194 } },
      }),
    ]);

    const text = treeText(panel);
    expect(text).toContain("pages");
    expect(text).toContain("Array(1)");
    // Past the first level it is collapsed, so the row is a label — not 100kB of products.
    const nested = panel.shadowRoot.querySelectorAll(".jv-node");
    expect(Array.from(nested).some((n) => !(n as HTMLDetailsElement).open)).toBe(true);
  });

  it("says what it dropped when a value is larger than the inline budget", () => {
    const many = Array.from({ length: 600 }, (_, i) => ({ id: i }));
    const panel = mount(() => [node("App", "component", { state: { many } })]);

    expect(treeText(panel)).toContain("more — open the full view");
  });

  it("names a cycle rather than walking into it", () => {
    const loop: Record<string, unknown> = { name: "a" };
    loop.self = loop;
    const panel = mount(() => [node("App", "component", { state: { loop } })]);

    expect(treeText(panel)).toContain("[circular]");
  });

  /**
   * A value id carries a prop name, and a prop name can carry a quote — the same shape as the
   * query hash that made `querySelector` throw on every poll. The patch path looks its element up
   * in a Map, so there is no selector to break.
   */
  it("updates a value whose key contains a quote", () => {
    let count = 1;
    const panel = mount(() => [node("App", "component", { state: { 'a"b': { count } } })]);
    expect(treeText(panel)).toContain("1");

    count = 2;
    window.dispatchEvent(new CustomEvent("ramonda:tick"));

    expect(treeText(panel)).toContain("2");
  });

  it("re-renders the tree on a change, and flashes the row", () => {
    let items = [1, 2];
    const panel = mount(() => [node("App", "component", { state: { items } })]);

    items = [1, 2, 3];
    window.dispatchEvent(new CustomEvent("ramonda:tick"));

    expect(treeText(panel)).toContain("Array(3)");
    expect(panel.shadowRoot.querySelector(".state-row.updated")).not.toBe(null);
  });
});

describe("the full view", () => {
  const open = (panel: Panel) => {
    panel.shadowRoot.querySelector("[data-full]")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  };
  const modal = (panel: Panel) => panel.shadowRoot.querySelector("#jv-modal")!;

  function withValue(): Panel {
    const many = Array.from({ length: 600 }, (_, i) => ({ id: i, title: `p${i}` }));
    return mount(() => [node("App", "component", { state: { feed: { products: many } } })]);
  }

  it("opens one value on the whole panel, past the inline budget", () => {
    const panel = withValue();
    open(panel);

    expect(modal(panel).classList.contains("on")).toBe(true);
    expect(panel.shadowRoot.querySelector("#jv-modal-title")!.textContent).toContain("feed");
    // The inline tree stopped at 400 rows; this one holds all 600 products.
    expect(panel.shadowRoot.querySelector("#jv-modal-body")!.textContent).toContain("p599");
  });

  it("switches to pretty JSON and back", () => {
    const panel = withValue();
    open(panel);

    panel.shadowRoot.querySelector("#jv-raw")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const raw = panel.shadowRoot.querySelector(".jv-raw");
    expect(raw).not.toBe(null);
    expect(raw!.textContent).toContain('"title": "p0"');

    panel.shadowRoot.querySelector("#jv-raw")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(panel.shadowRoot.querySelector(".jv-raw")).toBe(null);
  });

  /** Innermost first: Escape must close the value, not release the focused component under it. */
  it("takes Escape before the focus does", () => {
    const panel = withValue();
    focus(panel, "App");
    open(panel);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(modal(panel).classList.contains("on")).toBe(false);
    expect(panel.shadowRoot.querySelector("#crumbs")!.classList.contains("on")).toBe(true);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(panel.shadowRoot.querySelector("#crumbs")!.classList.contains("on")).toBe(false);
  });
});

describe("the Query tab's value", () => {
  const base = {
    key: ["products"],
    hash: '["products"]',
    status: "success",
    fetchStatus: "idle",
    observers: 1,
    failureCount: 0,
    restored: false,
  };

  function bridgeWith(rows: () => unknown[]): Panel {
    (window as unknown as { __RAMONDA_QUERY__: unknown }).__RAMONDA_QUERY__ = {
      snapshot: () => ({ clients: [{ index: 0, queries: rows() }] }),
      invalidate: vi.fn(),
      remove: vi.fn(),
    };
    const panel = mount(() => tree());
    openTab(panel, "query");
    return panel;
  }

  it("renders the cached value as a tree", () => {
    const panel = bridgeWith(() => [
      { ...base, updatedAt: 1, dataPreview: "…", data: { pages: [{ products: [{ id: 1 }] }] } },
    ]);

    const data = panel.shadowRoot.querySelector(".q-data")!;
    expect(data.querySelector(".jv")).not.toBe(null);
    expect(data.textContent).toContain("pages");
    openTab(panel, "logs");
  });

  /**
   * The bug this would otherwise have: the list rebuilt only when its one-line preview changed,
   * and a preview is capped — so appending an eighth page to an infinite query changed nothing
   * within the cap and the panel kept showing the seventh. A write moves `updatedAt`, always.
   */
  it("rebuilds when the data changes past the end of the preview", () => {
    let pages = [{ id: 1 }];
    let updatedAt = 1;
    const panel = bridgeWith(() => [{ ...base, updatedAt, dataPreview: "x".repeat(2000), data: { pages } }]);

    expect(panel.shadowRoot.querySelector(".q-data")!.textContent).toContain("Array(1)");

    pages = [{ id: 1 }, { id: 2 }];
    updatedAt = 2;
    (panel as unknown as { renderQueries(): void }).renderQueries();

    expect(panel.shadowRoot.querySelector(".q-data")!.textContent).toContain("Array(2)");
    openTab(panel, "logs");
  });

  it("opens a query's value on the whole panel", () => {
    const many = Array.from({ length: 600 }, (_, i) => ({ id: i, title: `p${i}` }));
    const panel = bridgeWith(() => [{ ...base, updatedAt: 1, dataPreview: "…", data: { products: many } }]);

    panel.shadowRoot.querySelector(".q-row [data-full]")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(panel.shadowRoot.querySelector("#jv-modal")!.classList.contains("on")).toBe(true);
    expect(panel.shadowRoot.querySelector("#jv-modal-body")!.textContent).toContain("p599");
    openTab(panel, "logs");
  });
});

/**
 * The gap that let an entire stylesheet section ship missing.
 *
 * Every other test here asserts STRUCTURE, so the value tree and the full view passed while their
 * CSS was not in the file at all — a patch anchored on a selector that had been reworded, and the
 * panel rendered correct markup with browser-default buttons. Structure tests cannot see that, so
 * this one reads the emitted classes back and asks the stylesheet about each of them.
 */
describe("the stylesheet", () => {
  const styleText = (panel: Panel) => panel.shadowRoot.querySelector("style")!.textContent!;

  function classesIn(root: ParentNode): Set<string> {
    const found = new Set<string>();
    for (const element of Array.from(root.querySelectorAll("[class]"))) {
      for (const name of Array.from(element.classList)) found.add(name);
    }
    return found;
  }

  it("has a rule for every class the panel renders", () => {
    const panel = mount(() => [
      node("App", "component", {
        state: { feed: { pages: [{ id: 1 }] } },
        props: { title: "x" },
        hooks: [node("Query", "hook", { options: { key: '["products"]' } })],
      }),
    ]);
    // Open one value on the whole panel, so the modal's own classes are rendered too.
    panel.shadowRoot.querySelector("[data-full]")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const css = styleText(panel);
    const unstyled = Array.from(classesIn(panel.shadowRoot)).filter((name) => !css.includes(`.${name}`));

    expect(unstyled).toEqual([]);
  });

  /**
   * A floor, because the panel is a listing of code and the smallest text in it is the keys and
   * the values — the text you actually read. Everything was sized for a 900px drawer and was too
   * small once the panel became something you dock at 620.
   */
  it("sets no font smaller than 10.5px", () => {
    const sizes = Array.from(styleText(mount(() => tree())).matchAll(/font-size: ([0-9.]+)px/g)).map((m) =>
      Number(m[1]),
    );

    expect(sizes.length).toBeGreaterThan(10);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(10.5);
  });

  it("keeps the disclosure triangles as single-backslash CSS escapes", () => {
    const panel = mount(() => tree());

    // The stylesheet lives in a template literal, so `\\25B8` in the source is what puts `\25B8`
    // in the CSS. Getting that wrong is a TS octal-escape error at build time in one direction and
    // a literal backslash-2-5 in the content in the other.
    expect(styleText(panel)).toContain('content: "\\25B8"');
    expect(styleText(panel)).toContain('content: "\\25BE"');
  });
});

describe("a full view that has gone stale", () => {
  const refresh = (panel: Panel) => panel.shadowRoot.querySelector("#jv-refresh") as HTMLElement;
  const body = (panel: Panel) => panel.shadowRoot.querySelector("#jv-modal-body")!;
  const title = (panel: Panel) => panel.shadowRoot.querySelector("#jv-modal-title")!.textContent!;

  it("lights the refresh button when the app writes a different value, and shows it on click", () => {
    let items = [1, 2];
    const panel = mount(() => [node("App", "component", { state: { items } })]);
    panel.shadowRoot.querySelector("[data-full]")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(title(panel)).toContain("Array(2)");
    expect(refresh(panel).classList.contains("stale")).toBe(false);

    items = [1, 2, 3, 4];
    window.dispatchEvent(new CustomEvent("ramonda:tick"));

    // Lit, but NOT repainted: the tree must not move while it is being read.
    expect(refresh(panel).classList.contains("stale")).toBe(true);
    expect(title(panel)).toContain("Array(2)");

    refresh(panel).dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(title(panel)).toContain("Array(4)");
    expect(body(panel).textContent).toContain("3");
    expect(refresh(panel).classList.contains("stale")).toBe(false);
  });

  it("stays dark when the value is rebuilt but equal", () => {
    const panel = mount(() => [node("App", "component", { state: { items: [1, 2] } })]);
    panel.shadowRoot.querySelector("[data-full]")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // A fresh array with the same contents on every read — the shape a props callback produces.
    window.dispatchEvent(new CustomEvent("ramonda:tick"));

    expect(refresh(panel).classList.contains("stale")).toBe(false);
  });

  it("says so when the value is gone rather than refreshing to nothing", () => {
    let mounted = true;
    const panel = mount(() =>
      mounted
        ? [node("App", "component", { children: [node("Leaf", "component", { state: { items: [1] } })] })]
        : [node("App", "component", {})],
    );
    panel.shadowRoot.querySelector("[data-full]")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(body(panel).textContent).toContain("Array(1)");

    mounted = false;
    window.dispatchEvent(new CustomEvent("ramonda:tick"));

    expect(refresh(panel).classList.contains("gone")).toBe(true);
    refresh(panel).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // The last snapshot is kept: replacing it with an empty tree would destroy what was being read.
    expect(body(panel).textContent).toContain("Array(1)");
  });

  it("keeps a query value readable while the Components tab is open", () => {
    (window as unknown as { __RAMONDA_QUERY__: unknown }).__RAMONDA_QUERY__ = {
      snapshot: () => ({
        clients: [
          {
            index: 0,
            queries: [
              {
                key: ["products"],
                hash: '["products"]',
                status: "success",
                fetchStatus: "idle",
                observers: 1,
                updatedAt: 1,
                failureCount: 0,
                restored: false,
                dataPreview: "…",
                data: { pages: [{ id: 1 }] },
              },
            ],
          },
        ],
      }),
      invalidate: vi.fn(),
      remove: vi.fn(),
    };

    const panel = mount(() => tree());
    openTab(panel, "query");
    panel.shadowRoot.querySelector(".q-row [data-full]")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(body(panel).textContent).toContain("pages");

    // Component values live in a map that is replaced on every structural render; a query value
    // must not be swept away with it.
    openTab(panel, "components");
    window.dispatchEvent(new CustomEvent("ramonda:tick"));

    expect(refresh(panel).classList.contains("gone")).toBe(false);
    expect(body(panel).textContent).toContain("pages");
  });
});
