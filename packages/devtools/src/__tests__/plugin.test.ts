import { beforeEach, describe, expect, it, vi } from "vitest";
import "../index";
import { panelRegistry } from "../index";
import type { PanelPlugin } from "../index";

/**
 * The plugin contract, tested through something that is not the query cache.
 *
 * Query is the first consumer, and testing only through it would prove that the panel renders
 * query — which it did before any of this existed. A second source with a different shape is what
 * says the contract is a contract.
 */

type Panel = HTMLElement & { shadowRoot: ShadowRoot; toggle(): void };

beforeEach(() => {
  document.body.innerHTML = "";
  // Both stores leak from one test into the next, and `toggle()` FLIPS — so a test that ran
  // before this one leaving `open` behind means the next panel opens closed, and every assertion
  // about what it rendered is about a panel nobody opened.
  localStorage.clear();
  sessionStorage.clear();
  (window as unknown as { __RAMONDA_INSPECT__: unknown }).__RAMONDA_INSPECT__ = () => [];
});

/**
 * The package's only public API, imported the way the docs say to import it.
 *
 * Everything else in `@ramonda/devtools` is the panel's own implementation — an app imports the
 * module for its side effect and never names anything from it. This is the exception, so it is
 * worth a test that goes through the entry point rather than reaching into a file.
 */
describe("what @ramonda/devtools exports", () => {
  it("hands out one registry, and a deregister that removes exactly what it registered", () => {
    const plugin: PanelPlugin = { version: 1, id: "sockets", label: "SOCKETS", snapshot: () => ({ groups: [] }) };

    expect(panelRegistry()).toBe(panelRegistry());

    const off = panelRegistry().register(plugin);
    expect(panelRegistry().list()).toContain(plugin);

    off();
    expect(panelRegistry().list()).not.toContain(plugin);
  });

  it("refuses a version it does not know rather than half-drawing it", () => {
    const future = { version: 2, id: "future", label: "F", snapshot: () => ({ groups: [] }) };
    const off = panelRegistry().register(future as unknown as PanelPlugin);

    expect(
      panelRegistry()
        .list()
        .map((p) => p.id),
    ).not.toContain("future");
    off();
  });

  it("survives a source remounting, which registers before the old one cleans up", () => {
    const first: PanelPlugin = { version: 1, id: "dup", label: "D", snapshot: () => ({ groups: [] }) };
    const second: PanelPlugin = { version: 1, id: "dup", label: "D", snapshot: () => ({ groups: [] }) };

    const offFirst = panelRegistry().register(first);
    const offSecond = panelRegistry().register(second);

    // The order a provider actually produces: the new instance registers in its `@create`, and the
    // old one's `@destroy` runs afterwards. Deleting by id alone would drop the LIVE panel.
    offFirst();
    expect(panelRegistry().list()).toContain(second);

    offSecond();
    expect(
      panelRegistry()
        .list()
        .filter((p) => p.id === "dup"),
    ).toHaveLength(0);
  });
});

describe("a row described as data", () => {
  const container = (panel: Panel) => panel.shadowRoot.querySelector("#plugin-query-container")!;

  /** Registers one source and opens its tab — the path a third-party panel takes. */
  function withRows(rows: unknown[], run?: (rowId: string, actionId: string) => string | undefined): Panel {
    panelRegistry().register({
      version: 1,
      id: "query",
      label: "QUERY",
      snapshot: () => ({ groups: [{ rows: rows as never }] }),
      run,
    });
    const panel = document.createElement("ramonda-devtools") as Panel;
    document.body.append(panel);
    panel.toggle();
    panel.shadowRoot.querySelector('.tab[data-tab="plugin-query"]')!.dispatchEvent(new Event("click"));
    return panel;
  }

  const row = (over: Record<string, unknown> = {}) => ({
    id: '0::["products"]',
    title: '["products"]',
    code: true,
    status: "ok",
    fields: [
      { kind: "text", text: "success" },
      { kind: "live", id: "age", text: "updated 1s ago" },
    ],
    value: { data: { a: 1 }, preview: "{…}", revision: 1, editable: true, write: () => undefined },
    actions: [{ id: "invalidate", label: "invalidate" }],
    ...over,
  });

  it("colours the status dot from the row's status, not from anything the source knows", () => {
    const panel = withRows([row({ status: "error", error: "Failed to fetch" })]);

    const dot = container(panel).querySelector(".q-status") as HTMLElement;
    // The token, not the value: the panel owns what "error" looks like, and a source that returned
    // a colour of its own would be the thing this test exists to prevent.
    expect(dot.style.background).toBe("var(--rmd-error)");
    expect(container(panel).querySelector(".q-error")!.textContent).toBe("Failed to fetch");
  });

  it("renders a badge for each badge field, and none when there are none", () => {
    const busy = withRows([
      row({
        fields: [
          { kind: "badge", text: "fetching…", tone: "warn" },
          { kind: "badge", text: "from server" },
        ],
      }),
    ]);
    expect(busy.shadowRoot.querySelector(".q-fetching")!.textContent).toBe("fetching…");
    expect(busy.shadowRoot.querySelector(".q-badge")!.textContent).toBe("from server");

    document.body.innerHTML = "";
    const quiet = withRows([row()]);
    expect(quiet.shadowRoot.querySelector(".q-fetching")).toBe(null);
    expect(quiet.shadowRoot.querySelector(".q-badge")).toBe(null);
  });

  it("offers the pencil only when the source says the value is editable", () => {
    const editable = withRows([row()]);
    expect(editable.shadowRoot.querySelector("[data-p-edit]")).not.toBe(null);

    document.body.innerHTML = "";
    // `truncated` is the source saying: this copy hit a bound, writing it back would be a lie.
    const bounded = withRows([row({ value: { data: { a: 1 }, editable: false } })]);
    expect(bounded.shadowRoot.querySelector("[data-p-edit]")).toBe(null);
  });

  it("shows the source's preview when there is no structured value", () => {
    const panel = withRows([row({ value: { data: undefined, preview: "{products: […]}" } })]);

    expect(container(panel).querySelector(".q-data")!.textContent).toBe("{products: […]}");
    // And no expand button, because there is nothing structured to open.
    expect(container(panel).querySelector("[data-full]")).toBe(null);
  });

  it("keeps a live field's node across a poll, and rebuilds when the revision moves", () => {
    vi.useFakeTimers();
    try {
      let revision = 1;
      let clock = "updated 3s ago";
      const panel = withRows([]);
      panelRegistry().register({
        version: 1,
        id: "query",
        label: "QUERY",
        snapshot: () => ({
          groups: [
            {
              rows: [
                { ...row(), fields: [{ kind: "live", id: "age", text: clock }], value: { data: { a: 1 }, revision } },
              ],
            },
          ] as never,
        }),
      });
      panel.shadowRoot.querySelector('.tab[data-tab="plugin-query"]')!.dispatchEvent(new Event("click"));

      const live = container(panel).querySelector("[data-live]") as HTMLElement;
      const rowNode = container(panel).querySelector(".q-row");

      // The clock alone: the text moves, every node stays.
      clock = "updated 5s ago";
      vi.advanceTimersByTime(600);
      expect(container(panel).querySelector(".q-row")).toBe(rowNode);
      expect(container(panel).querySelector("[data-live]")).toBe(live);
      expect(live.textContent).toBe("updated 5s ago");

      // The revision: the list is rebuilt, because something other than the clock changed.
      revision = 2;
      vi.advanceTimersByTime(600);
      expect(container(panel).querySelector(".q-row")).not.toBe(rowNode);
    } finally {
      vi.useRealTimers();
    }
  });

  it("addresses an action by row id, quotes and all", () => {
    const run = vi.fn(() => undefined);
    const panel = withRows([row()], run);

    const button = container(panel).querySelector('[data-p-action="invalidate"]') as HTMLElement;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Whole, quotes intact — a row id is the source's own format, and taking it apart is its job.
    expect(run).toHaveBeenCalledWith('0::["products"]', "invalidate");
  });

  it("survives a source whose snapshot throws", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      panelRegistry().register({
        version: 1,
        id: "query",
        label: "QUERY",
        snapshot: () => {
          throw new Error("cache is on fire");
        },
      });
      const panel = document.createElement("ramonda-devtools") as Panel;
      document.body.append(panel);
      panel.toggle();

      // The panel is most likely open BECAUSE something is wrong; it must not go down with it.
      expect(() =>
        panel.shadowRoot.querySelector('.tab[data-tab="plugin-query"]')!.dispatchEvent(new Event("click")),
      ).not.toThrow();
      expect(container(panel).textContent).toContain("could not be read");
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});
