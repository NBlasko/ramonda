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

    panel.shadowRoot.querySelector('#crumbs [data-crumb=""]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

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
  };

  function withBridge(): { panel: Panel; invalidate: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> } {
    const invalidate = vi.fn();
    const remove = vi.fn();
    (window as unknown as { __RAMONDA_QUERY__: unknown }).__RAMONDA_QUERY__ = {
      snapshot: () => ({ clients: [{ index: 0, queries: [row] }] }),
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

    const refresh = () =>
      (panel as unknown as { renderQueries(): void }).renderQueries.call(panel);
    expect(refresh).not.toThrow();
    // The same element, updated in place: rebuilding the list is what made the tab flicker.
    expect(container.querySelector("[data-q-age]")).toBe(age);

    openTab(panel, "logs");
  });
});
