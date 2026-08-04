import { beforeEach, describe, expect, it, vi } from "vitest";
import "../index";
import { panelRegistry } from "../panelPlugin";

/**
 * The panel, driven the way an app drives it: a tree published on `window`, a tab clicked, and
 * the shadow DOM read back.
 *
 * Every case here is a bug that shipped. The pinned view rebuilding on every tick, an attribute
 * that was never escaped so both Query buttons were dead, a filter that had to survive a
 * structural re-render — all of them are DOM facts, and all of them were found by hand.
 */

interface Node {
  /** Core's handle for the node, which a write is addressed to. */
  id: number;
  name: string;
  source?: { file: string; line: number; column: number };
  kind: "component" | "hook";
  state: Record<string, unknown>;
  /** What an instance answered from its own `[INSPECT]()`. */
  detail?: Record<string, unknown>;
  props?: Record<string, unknown>;
  options?: Record<string, unknown>;
  hooks: Node[];
  children: Node[];
  node?: unknown;
}

const node = (name: string, kind: "component" | "hook", extra: Partial<Node> = {}): Node => ({
  id: 0,
  name,
  kind,
  state: {},
  hooks: [],
  children: [],
  ...extra,
});

/**
 * Numbers a tree the way core does — a node, then its hooks, then its children — because a handle is
 * an index into the instances ONE scan saw.
 *
 * Done on every read rather than once when the tree is built: core renumbers from zero on each scan,
 * and a test whose ids drifted upward with every re-render would be testing something no app does.
 */
function assignIds(nodes: Node[], counter = { next: 0 }): Node[] {
  for (const item of nodes) {
    item.id = counter.next++;
    assignIds(item.hooks, counter);
    assignIds(item.children, counter);
  }
  return nodes;
}

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

/**
 * A fresh page: the element is created and left exactly as the session store puts it, which is what
 * a reload looks like. Nothing is opened and no tab is clicked.
 */
function reload(inspect: () => Node[] = () => tree()): Panel {
  document.body.innerHTML = "";
  (window as unknown as { __RAMONDA_INSPECT__: unknown }).__RAMONDA_INSPECT__ = () => assignIds(inspect());

  const panel = document.createElement("ramonda-devtools") as Panel;
  document.body.append(panel);
  return panel;
}

/** A fresh page with the panel opened the way a reader opens it — through the badge's `toggle`. */
function mount(inspect: () => Node[]): Panel {
  const panel = reload(inspect);
  (panel as unknown as { toggle(): void }).toggle();
  openTab(panel, "components");
  return panel;
}

function openTab(panel: Panel, name: string): void {
  panel.shadowRoot.querySelector(`.tab[data-tab="${name}"]`)!.dispatchEvent(new Event("click"));
}

/**
 * Lets one poll through, for a test whose subject is what polling does.
 *
 * The tabs that poll — query and profile — own their timers and keep their renders private, so a
 * test drives them the way the panel does rather than by calling in. That is the honest form
 * anyway: "the list holds still while it is typed into" is a claim about the POLL, and calling the
 * render by hand would prove it about something no reader ever triggers.
 *
 * Fake timers go in FIRST, around the mount as well as the tick: `useFakeTimers` replaces the
 * global, it does not adopt an interval already running, so a tab started under real timers polls
 * on its own schedule and no amount of advancing reaches it.
 */
function underPoll<T>(body: () => T): T {
  vi.useFakeTimers();
  try {
    return body();
  } finally {
    vi.useRealTimers();
  }
}

/** Advances past one tick of the query tab's 500 ms poll. Call inside `underPoll`. */
function pollOnce(): void {
  vi.advanceTimersByTime(600);
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

/** The framework's own open — a `forceOpen` toggle, the path core uses. */
function forceOpen(): void {
  window.dispatchEvent(new CustomEvent("ramonda:toggle-devtools", { detail: { forceOpen: true } }));
}

/** One dev error, as core reports it. */
function devError(id: string, message = "RMD001"): void {
  window.dispatchEvent(new CustomEvent("ramonda:dev-log", { detail: { type: "error", message, id, timestamp: "t" } }));
}

beforeEach(() => {
  document.body.innerHTML = "";
  // Preferences live in localStorage and the debugging session in sessionStorage; both would leak
  // from one test into the next — a focused component most visibly.
  localStorage.clear();
  sessionStorage.clear();
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

/**
 * A source registered the way `@ramonda/query` registers: rows of typed fields, no markup.
 *
 * These used to mock `__RAMONDA_QUERY__`, a bridge this package understood. It does not any more —
 * the cache describes itself now, and what is left here is the RENDERER, which is what devtools
 * owns. So the fixtures speak the contract, and the assertions below are about how a row reads
 * rather than about queries.
 */
function pluginRow(over: Record<string, unknown> = {}) {
  return {
    id: '0::["products"]',
    title: '["products"]',
    code: true,
    status: "ok",
    fields: [
      { kind: "text", text: "success" },
      { kind: "live", id: "age", text: "updated 1s ago" },
      { kind: "text", text: "1 observer" },
      { kind: "badge", text: "from server" },
    ],
    value: {
      data: { products: [{ id: 1, title: "Mascara" }] },
      preview: '{"products":[]}',
      revision: 1,
      editable: true,
      writeNote: "a refetch will replace it",
      write: () => undefined,
    },
    actions: [
      { id: "invalidate", label: "invalidate" },
      { id: "remove", label: "remove" },
    ],
    ...over,
  };
}

describe("a registered tab", () => {
  function withBridge(rows: () => unknown[] = () => [pluginRow()]): {
    panel: Panel;
    invalidate: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    off: () => void;
  } {
    const invalidate = vi.fn();
    const remove = vi.fn();
    const off = panelRegistry().register({
      version: 1,
      id: "query",
      label: "QUERY",
      snapshot: () => ({ groups: [{ rows: rows() as never }] }),
      run: (rowId, actionId) => {
        if (actionId === "invalidate") invalidate(rowId);
        else remove(rowId);
        return undefined;
      },
    });

    const panel = mount(() => tree());
    openTab(panel, "plugin-query");
    return { panel, invalidate, remove, off };
  }

  /**
   * The bug this locks: a row id carries the query's hash, which is JSON, so it carries quotes —
   * and `data-p-row="0::["products"]"` ends the attribute at the second one. The id came back as
   * `0::[`, the bridge looked up an entry that cannot exist, and both buttons did nothing —
   * silently, with no error anywhere.
   */
  it("round-trips a quoted key hash through the markup", () => {
    const { panel, invalidate, remove } = withBridge();

    const buttons = Array.from(panel.shadowRoot.querySelectorAll("[data-p-action]")) as HTMLElement[];
    expect(buttons.map((b) => b.dataset.pRow)).toEqual(['0::["products"]', '0::["products"]']);

    // The id reaches `run` whole, quotes intact. Taking it apart is the SOURCE's job — it chose
    // the format and is the only side that knows where the separator is.
    buttons[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(invalidate).toHaveBeenCalledWith('0::["products"]');

    buttons[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(remove).toHaveBeenCalledWith('0::["products"]');

    openTab(panel, "logs"); // stops the poll
  });

  /**
   * The same broken attribute is why the age element could not be found — and why the poll threw
   * `not a valid selector` four times a second once it was looked up by selector.
   */
  it("refreshes an age in place without building a selector from data", () => {
    underPoll(() => {
      const { panel } = withBridge();
      const container = panel.shadowRoot.querySelector("#plugin-query-container")!;
      const age = container.querySelector("[data-live]") as HTMLElement;

      expect(age.dataset.live).toBe('0::["products"]::age');

      // Driven by the poll, which is where the broken selector threw four times a second.
      expect(() => pollOnce()).not.toThrow();
      // The same element, updated in place: rebuilding the list is what made the tab flicker.
      expect(container.querySelector("[data-live]")).toBe(age);

      openTab(panel, "logs");
    });
  });
});

const margin = () => document.body.style.marginRight;

/**
 * A panel taken out of the document must stop asking the app for things.
 *
 * The flag every window listener is guarded on cannot cover an interval — it fires whether or not
 * anybody reads the result — and both polling tabs poll a BRIDGE, so a removed panel went on
 * calling into the query cache and the profiler. Measured before it was fixed: thirteen more calls
 * over five seconds, and still going.
 */
describe("a removed panel", () => {
  it("stops polling", () => {
    underPoll(() => {
      const commits = vi.fn(() => []);
      (window as unknown as { __RAMONDA_PROFILE__: unknown }).__RAMONDA_PROFILE__ = {
        start: vi.fn(),
        stop: vi.fn(),
        isRecording: () => true,
        commits,
      };

      const panel = mount(() => tree());
      openTab(panel, "profile");
      vi.advanceTimersByTime(1000);
      expect(commits.mock.calls.length).toBeGreaterThan(0);

      panel.remove();
      const after = commits.mock.calls.length;
      vi.advanceTimersByTime(5000);

      expect(commits.mock.calls.length).toBe(after);
    });
  });
});

describe("docking", () => {
  const layout = (panel: Panel) => (panel as unknown as { applyLayout(): void }).applyLayout();
  const toggle = (panel: Panel) => (panel as unknown as { toggle(): void }).toggle();

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
   * The reason two layouts exist. The framework can open the panel itself, and squeezing the page
   * then is destructive: the app reflows, a media query flips, and the layout you are shown is not
   * the one the problem happened in. A tool must not change the evidence by arriving.
   */
  it("does not reflow the app when the framework opens it", () => {
    const panel = mount(() => tree());
    toggle(panel); // start closed, at the app's own layout
    expect(margin()).toBe("17px");

    forceOpen();

    expect(panel.hasAttribute("open")).toBe(true);
    expect(margin()).toBe("17px");
    expect(panel.classList.contains("floating")).toBe(true);
    // It says why, because the reader did not choose this layout.
    expect(panel.shadowRoot.querySelector(".mode-note")).not.toBe(null);
  });

  it("leaves a docked panel alone when the framework asks again", () => {
    const panel = mount(() => tree());
    layout(panel);
    const docked = margin();
    expect(docked).toBe("0px");

    forceOpen();

    // Reflowing an already-open panel would destroy the layout being read.
    expect(margin()).toBe(docked);
    expect(panel.classList.contains("floating")).toBe(false);
  });

  it("docks on request, and remembers the choice", () => {
    const panel = mount(() => tree());
    toggle(panel);
    forceOpen();
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
  /** A plugin row with a value on it — the shape a source hands over, not a query's. */
  const valueRow = (value: Record<string, unknown>) =>
    pluginRow({ value: { editable: true, write: () => undefined, ...value } });

  function bridgeWith(rows: () => unknown[]): Panel {
    panelRegistry().register({
      version: 1,
      id: "query",
      label: "QUERY",
      snapshot: () => ({ groups: [{ rows: rows() as never }] }),
    });
    const panel = mount(() => tree());
    openTab(panel, "plugin-query");
    return panel;
  }

  it("renders the cached value as a tree", () => {
    const panel = bridgeWith(() => [
      valueRow({ revision: 1, preview: "…", data: { pages: [{ products: [{ id: 1 }] }] } }),
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
    underPoll(() => {
      let pages = [{ id: 1 }];
      let updatedAt = 1;
      const panel = bridgeWith(() => [valueRow({ revision: updatedAt, preview: "x".repeat(2000), data: { pages } })]);

      expect(panel.shadowRoot.querySelector(".q-data")!.textContent).toContain("Array(1)");

      pages = [{ id: 1 }, { id: 2 }];
      updatedAt = 2;
      pollOnce();

      expect(panel.shadowRoot.querySelector(".q-data")!.textContent).toContain("Array(2)");
      openTab(panel, "logs");
    });
  });

  it("opens a query's value on the whole panel", () => {
    const many = Array.from({ length: 600 }, (_, i) => ({ id: i, title: `p${i}` }));
    const panel = bridgeWith(() => [valueRow({ revision: 1, preview: "…", data: { products: many } })]);

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
    panelRegistry().register({
      version: 1,
      id: "query",
      label: "QUERY",
      snapshot: () => ({
        groups: [{ rows: [pluginRow({ value: { data: { pages: [{ id: 1 }] }, revision: 1 } })] }] as never,
      }),
    });
    const panel = mount(() => tree());
    openTab(panel, "plugin-query");
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

describe("a dev error", () => {
  const badge = (panel: Panel) => panel.shadowRoot.querySelector(".ramonda-badge") as HTMLElement;
  const count = (panel: Panel) => panel.shadowRoot.querySelector("#badge-count")!.textContent;

  /**
   * It used to open the panel, and that was wrong twice over: opening is an interruption, and a
   * docked panel opening also reflowed the app — so a media query flipped and the layout you were
   * shown was not the one the error happened in. The badge detonates instead. Nothing moves.
   */
  it("detonates the badge and leaves the app alone", () => {
    const panel = mount(() => tree());
    (panel as unknown as { toggle(): void }).toggle(); // closed
    expect(margin()).toBe("17px");

    devError("1");

    expect(panel.hasAttribute("open")).toBe(false);
    expect(margin()).toBe("17px");
    expect(panel.classList.contains("has-errors")).toBe(true);
    expect(badge(panel).classList.contains("boom")).toBe(true);
    expect(count(panel)).toBe("1");
  });

  it("counts up, and detonates again for each one", () => {
    const panel = mount(() => tree());
    devError("1");

    // The burst is one-shot and clears itself when it ends, so a second error has to restart it —
    // re-adding a class that is already there replays nothing.
    badge(panel).classList.remove("boom");
    devError("2");

    expect(count(panel)).toBe("2");
    expect(badge(panel).classList.contains("boom")).toBe(true);
  });

  it("counts a whole restored history at once", () => {
    const panel = mount(() => tree());
    // `mount` opens the panel to render the tree; a restored history arrives while it is closed.
    (panel as unknown as { toggle(): void }).toggle();
    window.dispatchEvent(
      new CustomEvent("ramonda:logs-sync", {
        detail: [
          { type: "error", message: "a", id: "1", timestamp: "t" },
          { type: "warning", message: "b", id: "2", timestamp: "t" },
          { type: "error", message: "c", id: "3", timestamp: "t" },
        ],
      }),
    );

    expect(count(panel)).toBe("2");
    expect(panel.hasAttribute("open")).toBe(false);
  });

  it("stops shouting once the panel is opened", () => {
    const panel = mount(() => tree());
    (panel as unknown as { toggle(): void }).toggle();
    devError("1");
    expect(panel.classList.contains("has-errors")).toBe(true);

    (panel as unknown as { toggle(): void }).toggle();

    expect(panel.classList.contains("has-errors")).toBe(false);
    expect(badge(panel).classList.contains("boom")).toBe(false);
  });

  it("caps the number rather than widening the badge", () => {
    const panel = mount(() => tree());
    for (let i = 0; i < 120; i++) devError(String(i));

    expect(count(panel)).toBe("99+");
  });
});

describe("what survives a reload", () => {
  /** A reload: a new element, inheriting nothing but the two stores. */
  const remount = () => reload();

  it("keeps the preferences: width, layout, and the two filters", () => {
    const panel = mount(() => tree());
    (panel as unknown as { toggle(): void }).toggle();

    panel.shadowRoot.querySelector("#mode-btn")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    panel.shadowRoot.querySelector('[data-tool="values"]')!.dispatchEvent(new Event("click"));
    panel.shadowRoot.querySelector('[data-tool="hooks"]')!.dispatchEvent(new Event("click"));

    const next = remount();
    const container = next.shadowRoot.querySelector("#components-container")!;

    expect(container.classList.contains("no-values")).toBe(true);
    expect(container.classList.contains("no-hooks")).toBe(true);
    // The label has to follow the state, or the button lies about what it will do.
    expect(next.shadowRoot.querySelector('[data-tool="values"]')!.textContent).toContain("show");
    expect(localStorage.getItem("ramonda:devtools-mode")).toBe("float");
  });

  it("picks the debugging session back up: open, tab, filter and focus", () => {
    const panel = mount(() => tree());
    openTab(panel, "plugin-query");
    openTab(panel, "components");
    focus(panel, "ProductDetail");

    const input = panel.shadowRoot.querySelector("#tree-filter") as HTMLInputElement;
    input.value = "detail";
    input.dispatchEvent(new Event("input"));

    const next = remount();

    expect(next.hasAttribute("open")).toBe(true);
    expect(next.shadowRoot.querySelector(".tab.active")!.textContent).toBe("COMPONENTS");
    expect((next.shadowRoot.querySelector("#tree-filter") as HTMLInputElement).value).toBe("detail");
    expect(summaries(next)).toEqual(["/0:component:App/0:component:ProductsPage/0:component:ProductDetail"]);
    expect(next.shadowRoot.querySelector("#crumbs")!.classList.contains("on")).toBe(true);
  });

  it("stays closed if it was closed", () => {
    const panel = mount(() => tree());
    (panel as unknown as { toggle(): void }).toggle();
    expect(panel.hasAttribute("open")).toBe(false);

    expect(remount().hasAttribute("open")).toBe(false);
  });

  /**
   * A focused path names a tree, so it cannot outlive the tab that was looking at it — and when the
   * page IS different, the breadcrumb already says the component is no longer mounted rather than
   * showing an empty panel.
   */
  it("keeps the session in sessionStorage, never in localStorage", () => {
    const panel = mount(() => tree());
    focus(panel, "ProductDetail");
    const input = panel.shadowRoot.querySelector("#tree-filter") as HTMLInputElement;
    input.value = "detail";
    input.dispatchEvent(new Event("input"));

    expect(sessionStorage.getItem("ramonda:devtools-pin")).toContain("ProductDetail");
    expect(sessionStorage.getItem("ramonda:devtools-filter")).toBe("detail");
    expect(localStorage.getItem("ramonda:devtools-pin")).toBe(null);
    expect(localStorage.getItem("ramonda:devtools-filter")).toBe(null);
  });
});

describe("keeping the reader's place", () => {
  const container = (panel: Panel) => panel.shadowRoot.querySelector("#components-container")!;
  const detailsFor = (panel: Panel, name: string) =>
    Array.from(container(panel).querySelectorAll("details")).find((d) =>
      d.querySelector(".comp-summary")?.getAttribute("data-path")?.endsWith(`:${name}`),
    ) as HTMLDetailsElement;

  /**
   * The controls are how you FIND a component, and they used to scroll away with the tree — so the
   * moment you found something and scrolled to read it, the search you found it with was gone.
   */
  it("puts the toolbar and the breadcrumb in one sticky header", () => {
    const panel = mount(() => tree());
    const head = panel.shadowRoot.querySelector(".tree-head")!;

    expect(head.querySelector("#tree-filter")).not.toBe(null);
    expect(head.querySelector('[data-tool="pick"]')).not.toBe(null);
    expect(head.querySelector("#crumbs")).not.toBe(null);
    // Sticky needs the scroll container to carry no padding of its own; the tree carries it.
    const css = panel.shadowRoot.querySelector("style")!.textContent!;
    expect(css).toContain(".tree-head { position: sticky");
    expect(css).toContain("#components-tab { padding: 0; }");
  });

  /**
   * A structural change replaces this subtree's markup, and `innerHTML` resets its container's
   * scroll to the top — so reading a component while the app did anything at all threw you back to
   * the root of the tree.
   */
  it("keeps the scroll position across a structural re-render", () => {
    let extra = false;
    const panel = mount(() => {
      const base = tree();
      if (extra) base[0].children.push(node("Later", "component", { state: { a: 1 } }));
      return base;
    });

    /**
     * jsdom has no layout and does not reset `scrollTop` when `innerHTML` is written, so asserting
     * the final value would pass even with the restore deleted — the first version of this test did
     * exactly that. What is asserted instead is the WRITE: the panel put the reader's position back
     * after the rebuild, which is the part a browser needs.
     */
    const scroller = panel.shadowRoot.querySelector("#components-tab") as HTMLElement;
    let position = 0;
    const writes: number[] = [];
    Object.defineProperty(scroller, "scrollTop", {
      get: () => position,
      set: (value: number) => {
        position = value;
        writes.push(value);
      },
      configurable: true,
    });

    scroller.scrollTop = 240;
    extra = true;
    window.dispatchEvent(new CustomEvent("ramonda:tick"));

    expect(summaries(panel)).toHaveLength(5);
    expect(writes).toEqual([240, 240]);
  });

  /** Without this, a tree the reader folded down to what they cared about unfolded itself. */
  it("keeps a folded branch folded across a structural re-render", () => {
    let extra = false;
    const panel = mount(() => {
      const base = tree();
      if (extra) base[0].children.push(node("Later", "component", { state: { a: 1 } }));
      return base;
    });

    detailsFor(panel, "ProductsPage").open = false;

    extra = true;
    window.dispatchEvent(new CustomEvent("ramonda:tick"));

    expect(detailsFor(panel, "ProductsPage").open).toBe(false);
    // Everything else is untouched: absent from the set means open, the default for a new node.
    expect(detailsFor(panel, "App").open).toBe(true);
    expect(detailsFor(panel, "Later").open).toBe(true);
  });

  it("folds and unfolds everything through the same record", () => {
    const panel = mount(() => tree());

    panel.shadowRoot.querySelector('[data-tool="collapse"]')!.dispatchEvent(new Event("click"));
    window.dispatchEvent(new CustomEvent("ramonda:tick"));
    expect(Array.from(container(panel).querySelectorAll("details")).every((d) => !d.open)).toBe(true);

    panel.shadowRoot.querySelector('[data-tool="expand"]')!.dispatchEvent(new Event("click"));
    window.dispatchEvent(new CustomEvent("ramonda:tick"));
    expect(Array.from(container(panel).querySelectorAll("details")).every((d) => d.open)).toBe(true);
  });
});

describe("resizing the panel", () => {
  const width = (panel: Panel) => panel.style.getPropertyValue("--panel-w");

  const drag = (panel: Panel, from: number, to: number) => {
    const handle = panel.shadowRoot.querySelector(".ramonda-resize")!;
    handle.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, clientX: from, bubbles: true, cancelable: true }),
    );
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: to }));
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: to }));
  };

  it("widens as the handle is dragged left, and remembers the width", () => {
    const panel = mount(() => tree());

    // jsdom reports a 0px panel, so the drag delta IS the width — which is the arithmetic under
    // test: dragging left must widen, because the panel is anchored to the right.
    drag(panel, 800, 400);

    expect(width(panel)).toBe("400px");
    expect(localStorage.getItem("ramonda:devtools-width")).not.toBe(null);
  });

  /** A panel dragged to 20px is unrecoverable: the handle goes with it. */
  it("refuses to shrink past the point where the handle is still grabbable", () => {
    const panel = mount(() => tree());

    drag(panel, 400, 800);

    expect(width(panel)).toBe("280px");
  });

  it("restores a remembered width on the next page", () => {
    localStorage.setItem("ramonda:devtools-width", "512");

    expect(width(reload())).toBe("512px");
  });
});

describe("the logs tab", () => {
  const rows = (panel: Panel) => panel.shadowRoot.querySelectorAll(".log-item");

  const log = (id: string, type = "info", data?: unknown) => {
    window.dispatchEvent(
      new CustomEvent("ramonda:dev-log", { detail: { type, message: `msg ${id}`, id, timestamp: "12:00", data } }),
    );
  };

  it("shows the newest first and lets a row be dismissed", () => {
    const panel = mount(() => tree());
    log("1");
    log("2");

    expect(rows(panel)).toHaveLength(2);
    expect(rows(panel)[0].textContent).toContain("msg 2");

    (rows(panel)[0].querySelector(".delete-btn") as HTMLElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );

    expect(rows(panel)).toHaveLength(1);
    expect(rows(panel)[0].textContent).toContain("msg 1");
  });

  /** A long session must not grow the panel's DOM without limit; the oldest row goes. */
  it("keeps at most 200 rows", () => {
    const panel = mount(() => tree());
    for (let i = 0; i < 205; i++) log(String(i));

    expect(rows(panel)).toHaveLength(200);
    expect(rows(panel)[0].textContent).toContain("msg 204");
  });

  it("escapes a message rather than rendering it", () => {
    const panel = mount(() => tree());
    window.dispatchEvent(
      new CustomEvent("ramonda:dev-log", {
        detail: { type: "info", message: "<img src=x>", id: "x", timestamp: "12:00" },
      }),
    );

    expect(rows(panel)[0].querySelector("img")).toBe(null);
    expect(rows(panel)[0].textContent).toContain("<img src=x>");
  });
});

describe("what the panel does while nobody is looking", () => {
  /**
   * The cost model the whole panel is built on: it PULLS, and only while its tab is open. A poll
   * that outlived the tab would read every live cache four times a second, forever, in every
   * development build.
   */
  it("stops polling the cache when its tab is left", () => {
    const snapshot = vi.fn(() => ({ groups: [{ rows: [] }] }));
    panelRegistry().register({ version: 1, id: "query", label: "QUERY", snapshot });
    const spy = { snapshot };

    vi.useFakeTimers();
    try {
      const panel = mount(() => tree());
      openTab(panel, "plugin-query");
      const opened = spy.snapshot.mock.calls.length;
      expect(opened).toBeGreaterThan(0);

      // Twice a second while the tab is open.
      vi.advanceTimersByTime(1100);
      expect(spy.snapshot.mock.calls.length).toBeGreaterThan(opened);

      openTab(panel, "components");
      const left = spy.snapshot.mock.calls.length;
      vi.advanceTimersByTime(5000);

      expect(spy.snapshot.mock.calls.length).toBe(left);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops reading the tree when the panel is closed", () => {
    let reads = 0;
    const panel = mount(() => {
      reads++;
      return tree();
    });

    (panel as unknown as { toggle(): void }).toggle();
    const after = reads;
    window.dispatchEvent(new CustomEvent("ramonda:tick"));

    expect(reads).toBe(after);
  });

  /** A panel taken out of the DOM must leave the page as it found it. */
  it("gives the body's margin back when it is removed", () => {
    const panel = mount(() => tree());
    (panel as unknown as { applyLayout(): void }).applyLayout();
    expect(document.body.style.marginRight).toBe("0px");

    panel.remove();

    expect(document.body.style.marginRight).toBe("17px");
  });
});

describe("an older query package", () => {
  /**
   * A panel can be newer than the `@ramonda/query` beside it, and then a row arrives with the old
   * one-line `dataPreview` and no `data`. It has to render as text rather than as an empty box —
   * the fallback is a fact about mixed versions, not a second code path to keep working.
   */
  it("falls back to the one-line preview when a row carries no structured value", () => {
    panelRegistry().register({
      version: 1,
      id: "query",
      label: "QUERY",
      snapshot: () => ({
        groups: [{ rows: [pluginRow({ value: { data: undefined, preview: "one line only" } })] }] as never,
      }),
    });
    const panel = mount(() => tree());
    openTab(panel, "plugin-query");

    // Nothing structured to render, and the source said what to show instead.
    expect(panel.shadowRoot.querySelector(".q-data")!.textContent).toBe("one line only");
    expect(panel.shadowRoot.querySelector("[data-full]")).toBe(null);
    openTab(panel, "logs");
  });
});

describe("the stacking order inside the panel", () => {
  /**
   * The bug this exists for: the sticky tree head was `z-index: 4` and the full value view was `3`,
   * so opening a value drew the toolbar and the breadcrumb ON TOP of it and cut the tree off two
   * rows in. Every other test here reads structure or classes, and neither can see a z-order — so
   * this one reads the numbers and asserts the order they have to be in.
   */
  it("puts the full value view above the sticky header, which is above the resize handle", () => {
    const css = mount(() => tree()).shadowRoot.querySelector("style")!.textContent!;

    const layer = (selector: string): number => {
      const rule = css.slice(css.indexOf(selector));
      const found = /z-index:\s*(\d+)/.exec(rule.slice(0, rule.indexOf("}")));
      if (!found) throw new Error(`${selector} declares no z-index`);
      return Number(found[1]);
    };

    const handle = layer(".ramonda-resize {");
    const head = layer(".tree-head {");
    const modal = layer(".jv-modal {");

    expect(head).toBeGreaterThan(handle);
    expect(modal).toBeGreaterThan(head);
  });
});

describe("opening a component in the editor", () => {
  const withSource = () =>
    mount(() => [
      node("App", "component", {
        source: { file: "http://localhost:3000/src/App.tsx?t=1712345", line: 18, column: 1 },
        children: [node("Bare", "component", { state: { a: 1 } })],
      }),
    ]);

  const buttons = (panel: Panel) => Array.from(panel.shadowRoot.querySelectorAll("[data-src-file]"));

  it("asks the dev server to open the file, root-relative and without the cache query", async () => {
    const fetchSpy = vi.fn(async (_url: string) => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const panel = withSource();
      // Only the node core could locate gets a button — one that does nothing is worse than none.
      expect(buttons(panel)).toHaveLength(1);

      buttons(panel)[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      // A task, not a microtask: the click resolves the position through the module's sourcemap
      // before it asks the editor to open anything, and that is two awaited fetches deep.
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Two fetches, in this order, and both are the point: the MODULE first, to resolve the stack
      // position through its inline sourcemap (a served module's lines are not the source's), then
      // the editor endpoint. This module answers without a map, so the position stands as captured.
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy.mock.calls[0]![0]).toBe("http://localhost:3000/src/App.tsx?t=1712345");

      // `src/App.tsx:18:1` — no origin, no `?t=`, and no leading slash, because Vite resolves what
      // it is given against the project root and a leading slash would make it absolute.
      expect(decodeURIComponent(fetchSpy.mock.calls[1]![0])).toBe("/__open-in-editor?file=src/App.tsx:18:1");

      // And it says so, because an editor that is asked to open a file does not necessarily come to
      // the front — without this, "the window did not raise" and "the button is broken" look the same.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(panel.shadowRoot.querySelector("#toast")!.textContent).toContain("Asked your editor to open");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  /** A custom server has no such endpoint. The location must still reach the reader. */
  it("falls back to the clipboard, and says so, when there is no endpoint", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    try {
      const panel = withSource();
      buttons(panel)[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(writeText).toHaveBeenCalledWith("src/App.tsx:18:1");
      // A toast, not a log row: the first version reported this in the LOGS tab, so on a server with
      // no endpoint the button looked dead while it was quietly copying the path.
      const toast = panel.shadowRoot.querySelector("#toast")!;
      expect(toast.classList.contains("on")).toBe(true);
      expect(toast.textContent).toContain("copied src/App.tsx:18:1");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  /**
   * The failure that started this: the endpoint answered 200 while doing nothing, because
   * `launch-editor` returns silently for a file that is not there. The panel now repeats whatever the
   * server said, so a path that cannot be resolved is a sentence on screen rather than silence.
   */
  it("repeats the server's own reason when it refuses", async () => {
    vi.stubGlobal("fetch", async (url: string) =>
      url.startsWith("/__open-in-editor")
        ? // 422, because 404 is how the panel recognises a server with no endpoint at all.
          new Response("no such file: assets/client.js", { status: 422 })
        : new Response("", { status: 200 }),
    );

    try {
      const panel = withSource();
      buttons(panel)[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      const toast = panel.shadowRoot.querySelector("#toast")!;
      expect(toast.classList.contains("on")).toBe(true);
      expect(toast.textContent).toContain("no such file: assets/client.js");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("leaves an absolute filesystem path alone", () => {
    const panel = mount(() => [
      node("Server", "component", { source: { file: "/home/me/app/src/App.tsx", line: 4, column: 2 } }),
    ]);

    const button = buttons(panel)[0] as HTMLElement;
    // Three attributes rather than one packed string: a path can contain whatever a filesystem
    // allows, and a delimiter built out of data is the bug this panel keeps rediscovering.
    expect(button.dataset.srcFile).toBe("/home/me/app/src/App.tsx");
    expect(button.dataset.srcLine).toBe("4");
    expect(button.dataset.srcColumn).toBe("2");
    expect((buttons(panel)[0] as HTMLElement).title).toContain("App.tsx:4");
  });

  it("does not toggle the row it lives in", () => {
    const panel = withSource();
    const details = panel.shadowRoot.querySelector("details") as HTMLDetailsElement;
    expect(details.open).toBe(true);

    vi.stubGlobal("fetch", async () => new Response("", { status: 200 }));
    try {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      buttons(panel)[0].dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("editing a state value", () => {
  const writeSpy = () => {
    const write = vi.fn(() => "ok" as const);
    (window as unknown as { __RAMONDA_WRITE__: unknown }).__RAMONDA_WRITE__ = write;
    return write;
  };

  const withState = () =>
    mount(() => [
      node("App", "component", {
        state: { count: 3, user: { name: "Ada" }, onPick: () => 1 },
        props: { label: "x" },
      }),
    ]);

  const pencils = (panel: Panel) => Array.from(panel.shadowRoot.querySelectorAll("[data-edit-node]")) as HTMLElement[];
  const editorIn = (panel: Panel) => panel.shadowRoot.querySelector(".edit-input") as HTMLInputElement | null;
  const note = (panel: Panel) => panel.shadowRoot.querySelector(".edit-note")!;

  const openEditor = (panel: Panel, key: string) => {
    const pencil = pencils(panel).find((p) => p.dataset.editKey === key);
    if (!pencil) throw new Error(`no pencil for ${key}`);
    pencil.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  };

  const press = (field: HTMLElement, key: string, modifiers: Partial<KeyboardEventInit> = {}) =>
    field.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers }));

  /**
   * Props are owned by whoever rendered the component and assigning to one throws in every build, so
   * the panel must not offer a box for them. A function in state has no JSON to type back either.
   */
  it("offers a pencil for state that round-trips, and for nothing else", () => {
    writeSpy();
    const panel = withState();

    expect(pencils(panel).map((p) => p.dataset.editKey)).toEqual(["count", "user"]);
  });

  it("offers none at all when core exposes no write side", () => {
    (window as unknown as { __RAMONDA_WRITE__?: unknown }).__RAMONDA_WRITE__ = undefined;

    expect(pencils(withState())).toEqual([]);
  });

  it("commits the parsed value, not the text", () => {
    const write = writeSpy();
    const panel = withState();

    openEditor(panel, "count");
    const field = editorIn(panel)!;
    expect(field.value).toBe("3");

    field.value = "42";
    press(field, "Enter");

    // `42`, the number — a panel that stored the string would be a panel that changed the type.
    expect(write).toHaveBeenCalledWith(0, "count", 42);
    expect(editorIn(panel)).toBe(null);
  });

  it("replaces a whole object, because a signal holds a value and not a proxy", () => {
    const write = writeSpy();
    const panel = withState();

    openEditor(panel, "user");
    const field = editorIn(panel)!;
    expect(field.value).toBe('{\n  "name": "Ada"\n}');

    field.value = '{ "name": "Grace" }';
    // Multi-line, so plain Enter has to stay a newline.
    press(field, "Enter");
    expect(write).not.toHaveBeenCalled();

    press(field, "Enter", { metaKey: true });
    expect(write).toHaveBeenCalledWith(0, "user", { name: "Grace" });
  });

  it("refuses invalid JSON without touching the app", () => {
    const write = writeSpy();
    const panel = withState();

    openEditor(panel, "count");
    const field = editorIn(panel)!;
    field.value = "not json";
    press(field, "Enter");

    expect(write).not.toHaveBeenCalled();
    expect(note(panel).textContent).toContain("not valid JSON");
    // Still open, with what was typed: an error must not throw away the reader's input.
    expect(editorIn(panel)!.value).toBe("not json");
  });

  it("reports a refusal from core in the row", () => {
    (window as unknown as { __RAMONDA_WRITE__: unknown }).__RAMONDA_WRITE__ = vi.fn(() => "not-state");
    const panel = withState();

    openEditor(panel, "count");
    const field = editorIn(panel)!;
    field.value = "5";
    press(field, "Enter");

    expect(note(panel).textContent).toContain("props are owned by the parent");
  });

  it("cancels on Escape without releasing the focused component", () => {
    writeSpy();
    const panel = withState();
    focus(panel, "App");
    openEditor(panel, "count");

    const field = editorIn(panel)!;
    field.value = "99";
    press(field, "Escape");

    expect(editorIn(panel)).toBe(null);
    // The panel's own Escape releases focus; an abandoned edit must not.
    expect(panel.shadowRoot.querySelector("#crumbs")!.classList.contains("on")).toBe(true);
  });

  it("abandons an edit that is clicked away from", () => {
    const write = writeSpy();
    const panel = withState();

    openEditor(panel, "count");
    const field = editorIn(panel)!;
    field.value = "7";
    field.dispatchEvent(new FocusEvent("blur"));

    expect(write).not.toHaveBeenCalled();
    expect(editorIn(panel)).toBe(null);
  });
});

describe("editing state on a hook", () => {
  /**
   * The bug this exists for, found by driving the real built bundle rather than a fixture: the pencil
   * packed `nodeId|key|valueId` into one attribute, and a value id contains the node's PATH — which
   * marks a hooks branch with `|h`. Every row that lives under a hook therefore had a pencil that did
   * nothing, while every test tree happened to put state on components whose paths have no `|`.
   */
  it("works for a value whose path contains the old delimiter", () => {
    const write = vi.fn(() => "ok" as const);
    (window as unknown as { __RAMONDA_WRITE__: unknown }).__RAMONDA_WRITE__ = write;

    const panel = mount(() => [
      node("App", "component", {
        hooks: [node("Router", "hook", { state: { routeState: { path: "/" } } })],
      }),
    ]);

    const pencil = panel.shadowRoot.querySelector("[data-edit-node]") as HTMLElement;
    expect(pencil.dataset.editVid).toContain("|h");

    pencil.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    const field = panel.shadowRoot.querySelector(".edit-input") as HTMLInputElement;
    expect(field).not.toBe(null);
    expect(field.value).toBe('{\n  "path": "/"\n}');

    field.value = '{ "path": "/products" }';
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));

    // The hook's own handle, not the component's.
    expect(write).toHaveBeenCalledWith(1, "routeState", { path: "/products" });
  });
});

describe("what the panel says about a write", () => {
  const toast = (panel: Panel) => panel.shadowRoot.querySelector("#toast")!;

  const edit = (panel: Panel, key: string, text: string) => {
    const pencil = Array.from(panel.shadowRoot.querySelectorAll("[data-edit-node]")).find(
      (p) => (p as HTMLElement).dataset.editKey === key,
    ) as HTMLElement;
    pencil.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const field = panel.shadowRoot.querySelector(".edit-input") as HTMLInputElement;
    field.value = text;
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));
  };

  it("says what it wrote", () => {
    (window as unknown as { __RAMONDA_WRITE__: unknown }).__RAMONDA_WRITE__ = vi.fn(() => "ok");
    const panel = mount(() => [node("App", "component", { state: { count: 1 } })]);

    edit(panel, "count", "42");

    expect(toast(panel).textContent).toBe("wrote count = 42");
  });

  it("says when the value was already that", () => {
    (window as unknown as { __RAMONDA_WRITE__: unknown }).__RAMONDA_WRITE__ = vi.fn(() => "unchanged");
    const panel = mount(() => [node("App", "component", { state: { count: 1 } })]);

    edit(panel, "count", "1");

    expect(toast(panel).textContent).toContain("already that value");
  });

  /**
   * The report that prompted this: editing a query hook's `version` DID land, and looked like nothing,
   * because `version` is an invalidation counter and the rendered data comes from the cache — so the
   * hook set it again immediately. "It worked and the app owns that field" and "it did not work" have
   * to look different.
   */
  it("says when the app replaced what was written", () => {
    (window as unknown as { __RAMONDA_WRITE__: unknown }).__RAMONDA_WRITE__ = vi.fn(() => "ok");
    let version = 2;
    const panel = mount(() => [node("App", "component", { hooks: [node("Query", "hook", { state: { version } })] })]);

    edit(panel, "version", "99");
    expect(toast(panel).textContent).toBe("wrote version = 99");

    // The hook's own machinery moves it on, the way a cache event does.
    version = 3;
    window.dispatchEvent(new CustomEvent("ramonda:tick"));

    expect(toast(panel).textContent).toContain("has since set it to 3");
  });

  it("stays quiet when the write stuck", () => {
    (window as unknown as { __RAMONDA_WRITE__: unknown }).__RAMONDA_WRITE__ = vi.fn(() => "ok");
    let count = 1;
    const panel = mount(() => [node("App", "component", { state: { count } })]);

    edit(panel, "count", "42");
    count = 42;
    window.dispatchEvent(new CustomEvent("ramonda:tick"));

    expect(toast(panel).textContent).toBe("wrote count = 42");
  });
});

describe("editing a query's cached data", () => {
  const row = (extra: Record<string, unknown> = {}) =>
    pluginRow({
      value: {
        data: { total: 2 },
        preview: "…",
        revision: 1,
        editable: true,
        writeNote: "a refetch will replace it",
        write: () => undefined,
        ...extra,
      },
    });

  /**
   * `null` means "this query package has no write side", not `undefined` — passing `undefined` hands
   * the parameter its DEFAULT, which is how the first version of the no-write-side test asserted
   * against a bridge that had one.
   */
  function withBridge(rows: () => unknown[] = () => [row()]) {
    panelRegistry().register({
      version: 1,
      id: "query",
      label: "QUERY",
      snapshot: () => ({ groups: [{ rows: rows() as never }] }),
    });
    const panel = mount(() => tree());
    openTab(panel, "plugin-query");
    return panel;
  }

  const pencil = (panel: Panel) =>
    panel.shadowRoot.querySelector("#plugin-query-container [data-p-edit]") as HTMLElement;

  /**
   * This is the one value in the panel whose change shows up on the page, because the cache is what a
   * query renders from — unlike a query hook's own `version`, which is an invalidation counter.
   */
  it("writes through the bridge, and says a refetch will replace it", () => {
    // `write` returns the REASON it refused, or nothing when it worked — so a source that returns
    // a truthy "ok" would have its success read as a refusal.
    const setData = vi.fn(() => undefined);
    const panel = withBridge(() => [row({ write: setData })]);

    pencil(panel).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const field = panel.shadowRoot.querySelector(".edit-input") as HTMLTextAreaElement;
    expect(field.value).toBe('{\n  "total": 2\n}');

    field.value = '{ "total": 99 }';
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));

    // One argument: the panel hands over what was typed. WHICH entry that is was decided by the
    // source when it built the row, and it closed over it.
    expect(setData).toHaveBeenCalledWith({ total: 99 });
    expect(panel.shadowRoot.querySelector("#toast")!.textContent).toContain("a refetch will replace it");
    openTab(panel, "logs");
  });

  /**
   * The copy the panel holds is bounded, and a bounded copy contains marker strings where values were
   * dropped. Writing one back would put `"[… budget]"` into the cache.
   */
  it("offers no pencil for a value that arrived truncated", () => {
    const panel = withBridge(() => [row({ editable: false })]);

    expect(pencil(panel)).toBe(null);
    openTab(panel, "logs");
  });

  it("offers no pencil when the query package has no write side", () => {
    const panel = withBridge(() => [row({ editable: false })]);

    expect(pencil(panel)).toBe(null);
    openTab(panel, "logs");
  });

  /** A cache event anywhere rebuilds this list twice a second; it must not do it mid-sentence. */
  it("holds the list still while it is being typed into", () => {
    underPoll(() => {
      let revision = 1;
      const panel = withBridge(() => [row({ revision })]);

      pencil(panel).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      const field = panel.shadowRoot.querySelector(".edit-input") as HTMLTextAreaElement;
      field.value = "typing…";

      // A real cache event: the revision moves, which is exactly what the list keys its rebuild
      // on — so without the guard this poll would replace the box mid-sentence.
      revision = 2;
      pollOnce();

      expect(panel.shadowRoot.querySelector(".edit-input")).toBe(field);
      expect((panel.shadowRoot.querySelector(".edit-input") as HTMLTextAreaElement).value).toBe("typing…");
      openTab(panel, "logs");
    });
  });

  it("says so when the entry was collected while the box was open", () => {
    const panel = withBridge(() => [row({ write: () => "that entry is no longer in the cache" })]);

    pencil(panel).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const field = panel.shadowRoot.querySelector(".edit-input") as HTMLTextAreaElement;
    field.value = "{}";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));

    expect(panel.shadowRoot.querySelector(".edit-note")!.textContent).toContain("no longer in the cache");
    openTab(panel, "logs");
  });
});

describe("the profiler tab", () => {
  const commit = (index: number, duration: number, components = [{ name: "Board", builds: 1, ms: duration }]) => ({
    index,
    at: index * 10,
    duration,
    builds: components.reduce((sum, c) => sum + c.builds, 0),
    components,
  });

  function withProfiler(state: { recording: boolean; commits: ReturnType<typeof commit>[] }) {
    const bridge = {
      start: vi.fn(() => {
        state.recording = true;
        state.commits = [];
      }),
      stop: vi.fn(() => {
        state.recording = false;
      }),
      isRecording: () => state.recording,
      commits: () => state.commits,
    };
    (window as unknown as { __RAMONDA_PROFILE__: unknown }).__RAMONDA_PROFILE__ = bridge;

    const panel = mount(() => tree());
    openTab(panel, "profile");
    return { panel, bridge };
  }

  const rows = (panel: Panel) =>
    Array.from(panel.shadowRoot.querySelectorAll(".p-row")).map((row) => row.getAttribute("data-p-commit"));

  it("explains what a commit is before anything is recorded", () => {
    const { panel } = withProfiler({ recording: false, commits: [] });

    expect(panel.shadowRoot.querySelector("#profile-container")!.textContent).toContain("one drain");
    expect(panel.shadowRoot.querySelector("#profile-record")!.textContent).toContain("record");
    openTab(panel, "logs");
  });

  it("starts and stops recording through the bridge", () => {
    const state = { recording: false, commits: [] as ReturnType<typeof commit>[] };
    const { panel, bridge } = withProfiler(state);

    panel.shadowRoot.querySelector("#profile-record")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(bridge.start).toHaveBeenCalled();
    expect(panel.shadowRoot.querySelector("#profile-record")!.textContent).toContain("stop");

    panel.shadowRoot.querySelector("#profile-record")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(bridge.stop).toHaveBeenCalled();
    openTab(panel, "logs");
  });

  /** The commit you just caused is the one you are looking for, so it is at the top. */
  it("lists commits newest first, with what each cost", () => {
    const { panel } = withProfiler({
      recording: true,
      commits: [
        commit(1, 4.5),
        commit(2, 12.25, [
          { name: "Board", builds: 1, ms: 9 },
          { name: "Row", builds: 40, ms: 3.25 },
        ]),
      ],
    });

    expect(rows(panel)).toEqual(["2", "1"]);

    const newest = panel.shadowRoot.querySelector(".p-row")!;
    expect(newest.querySelector(".p-ms")!.textContent).toBe("12.25 ms");
    expect(newest.querySelector(".p-builds")!.textContent).toContain("41 builds");
    // The count is the point: forty rows rebuilding for one change is the thing worth seeing.
    expect(newest.textContent).toContain("Row ×40");
    openTab(panel, "logs");
  });

  it("draws each component's share of its own commit", () => {
    const { panel } = withProfiler({
      recording: true,
      commits: [
        commit(1, 10, [
          { name: "Heavy", builds: 1, ms: 8 },
          { name: "Light", builds: 1, ms: 2 },
        ]),
      ],
    });

    const bars = Array.from(panel.shadowRoot.querySelectorAll(".p-bar span")) as HTMLElement[];
    expect(bars[0].style.width).toBe("100%");
    expect(bars[1].style.width).toBe("25%");
    openTab(panel, "logs");
  });

  /** An idle poll must not rewrite the list — the same rule the query tab had to learn. */
  it("writes no DOM when a poll finds nothing new", () => {
    vi.useFakeTimers();
    try {
      const { panel } = withProfiler({ recording: true, commits: [commit(1, 4)] });

      // Through the poll rather than by calling the render directly: the claim is about what
      // POLLING does, and the identity check below only means something if the row survived a real
      // tick. Several, so a slow reader is represented too.
      const before = panel.shadowRoot.querySelector(".p-row");
      vi.advanceTimersByTime(2000);

      expect(panel.shadowRoot.querySelector(".p-row")).toBe(before);
      openTab(panel, "logs");
    } finally {
      vi.useRealTimers();
    }
  });

  it("says so when the build has no profiler at all", () => {
    (window as unknown as { __RAMONDA_PROFILE__?: unknown }).__RAMONDA_PROFILE__ = undefined;
    const panel = mount(() => tree());
    openTab(panel, "profile");

    expect(panel.shadowRoot.querySelector("#profile-container")!.textContent).toContain("no profiler");
    openTab(panel, "logs");
  });

  it("polls only while its tab is open", () => {
    vi.useFakeTimers();
    try {
      const state = { recording: true, commits: [commit(1, 4)] };
      const { panel, bridge } = withProfiler(state);
      const reads = vi.spyOn(bridge, "commits");

      vi.advanceTimersByTime(1000);
      expect(reads.mock.calls.length).toBeGreaterThan(0);

      openTab(panel, "logs");
      const after = reads.mock.calls.length;
      vi.advanceTimersByTime(3000);

      expect(reads.mock.calls.length).toBe(after);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("how a row is laid out", () => {
  const rowFor = (panel: Panel, key: string) =>
    Array.from(panel.shadowRoot.querySelectorAll(".state-row")).find((row) =>
      row.querySelector(".sk")?.textContent?.startsWith(`${key}:`),
    ) as HTMLElement;

  /**
   * Every value used to be a key heading with a body underneath, which read as twelve rows for six
   * fields once most values were `3` and `"ada"`.
   */
  it("puts a scalar on one line with its key, and a container in a block", () => {
    const panel = mount(() => [
      node("App", "component", {
        state: { count: 3, name: "ada", ready: true, missing: null, items: [1, 2], user: { id: 1 } },
      }),
    ]);

    for (const key of ["count", "name", "ready", "missing"]) {
      const row = rowFor(panel, key);
      expect(row.classList.contains("one-line"), `${key} should be on one line`).toBe(true);
      // The value element is a SIBLING of the key, not in a block below it.
      expect(row.querySelector(".state-head")).toBe(null);
      expect(row.querySelector(".sv")).not.toBe(null);
    }

    for (const key of ["items", "user"]) {
      const row = rowFor(panel, key);
      expect(row.classList.contains("one-line"), `${key} should keep its block`).toBe(false);
      expect(row.querySelector(".state-head")).not.toBe(null);
    }
  });

  /**
   * The test is "does the tree render it as a LEAF", not "is it a primitive" — the same question the tree
   * asks. A class instance shows as its name and a `Date` as one line, so both belong beside their key;
   * the first version called them objects and gave `client: QueryClient` two lines for a one-word value.
   */
  it("puts a value the tree cannot open beside its key too", () => {
    class QueryClient {}
    const panel = mount(() => [
      node("App", "component", {
        state: { client: new QueryClient(), when: new Date("2020-01-01"), fn: () => 1, map: new Map() },
      }),
    ]);

    for (const key of ["client", "when", "fn", "map"]) {
      expect(rowFor(panel, key).classList.contains("one-line"), `${key} renders as a leaf`).toBe(true);
    }
  });

  /** Both shapes keep `.sv`, because that is what the patch path and the editor look up by id. */
  it("keeps a one-line value patchable and editable", () => {
    (window as unknown as { __RAMONDA_WRITE__: unknown }).__RAMONDA_WRITE__ = vi.fn(() => "ok");
    let count = 1;
    const panel = mount(() => [node("App", "component", { state: { count } })]);

    count = 2;
    window.dispatchEvent(new CustomEvent("ramonda:tick"));
    expect(rowFor(panel, "count").querySelector(".sv")!.textContent).toContain("2");

    const pencil = panel.shadowRoot.querySelector("[data-edit-node]") as HTMLElement;
    pencil.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(panel.shadowRoot.querySelector(".edit-input")).not.toBe(null);
  });
});

/**
 * The "Holds" block — what an instance answered from its own `[INSPECT]()`.
 *
 * The panel reads `@state`, props and context reads, all of which are about how a value was
 * DECLARED. A hook that keeps its state in plain fields behind a `@state` counter therefore showed
 * the counter and nothing else: `{ version: 7 }` for a form, and props that never change.
 */
describe("what an instance holds", () => {
  const holder = (detail?: Record<string, unknown>) => [
    node("App", "component", {
      children: [
        node("Signup", "component", {
          state: { version: 7 },
          hooks: [node("Form", "hook", { state: { version: 7 }, detail })],
        }),
      ],
    }),
  ];

  /** The keys of one titled block, read off the rendered panel. */
  function blockKeys(panel: Panel, title: string): string[] {
    const block = Array.from(panel.shadowRoot.querySelectorAll(".state-block")).find(
      (el) => el.querySelector(".state-title")?.textContent?.trim() === title,
    );
    // `sk` carries the key with a trailing colon.
    return Array.from(block?.querySelectorAll(".sk") ?? []).map((k) => k.textContent!.trim().replace(/:$/, ""));
  }

  it("shows what the instance answered, beside the counter that is all `state` has", () => {
    const panel = mount(() => holder({ values: { email: "a@b" }, isValid: false }));

    expect(panel.shadowRoot.innerHTML).toContain("Holds");
    expect(blockKeys(panel, "Holds")).toEqual(["values", "isValid"]);
    // And the counter is still there, under its own heading.
    expect(blockKeys(panel, "State")).toEqual(["version"]);
  });

  it("shows no block at all when the instance answered nothing", () => {
    // Most instances have no `[INSPECT]()`. An empty heading that reveals nothing is a lie the
    // reader has to click to disprove.
    const panel = mount(() => holder(undefined));

    expect(panel.shadowRoot.innerHTML).not.toContain("Holds");
  });

  it("is READ-ONLY, unlike State", () => {
    // This is what the instance DERIVED. A pencil beside it would offer a write that changes
    // nothing while looking as though it had.
    const panel = mount(() => holder({ values: { email: "a@b" } }));

    const editable = Array.from(panel.shadowRoot.querySelectorAll("[data-edit-key]")).map(
      (b) => (b as HTMLElement).dataset.editKey,
    );

    expect(editable).toContain("version");
    expect(editable).not.toContain("values");
  });

  it("a change inside it refreshes the tree rather than being read as `nothing moved`", () => {
    // The one that would fail silently. The panel compares a signature to decide whether to
    // rebuild; if `detail` were left out of it, a form's values would sit stale on screen and
    // `[INSPECT]` would look broken.
    let held: Record<string, unknown> = { values: { email: "" } };
    const panel = mount(() => holder(held));

    expect(panel.shadowRoot.innerHTML).toContain("email");

    held = { values: { email: "" }, submitCount: 1 };
    window.dispatchEvent(new CustomEvent("ramonda:tick"));

    expect(blockKeys(panel, "Holds")).toEqual(["values", "submitCount"]);
  });

  it("a component can hold something too, not just a hook", () => {
    const panel = mount(() => [node("App", "component", { detail: { rows: 3 }, children: [] })]);

    expect(blockKeys(panel, "Holds")).toEqual(["rows"]);
  });
});
