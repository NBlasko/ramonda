import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { Component, AsyncLoad, list } from "../index";
import { state } from "../base/decorators";
import { getDOM } from "../test/setup";
import type { RamondaNode } from "../types/vdom";

/**
 * Queue item 4: three mechanisms one inside another, each tested alone and never together.
 *
 * A `list()` mints identity for its rows and reuses their DOM across a change. A slot is content
 * written in one component and rendered in another, and belongs where it LANDS. `AsyncLoad` holds a
 * pending promise and swaps a fallback for a module when it arrives. Nesting them puts a promise in
 * flight inside a region whose rows can appear, disappear and move underneath it — and the question
 * is whether a load that is already running survives what the list does to its row.
 *
 * ## Wiring an AsyncLoad probe, which cost three false readings before it was right
 *
 * Every one of these looked like a framework bug and was a fault in the test:
 *
 * - **A fresh `lazy` arrow per render** hands `AsyncLoad` a new promise it never awaits, so the
 *   resolver kept here points at nothing and the row waits for ever. One function per id, memoised.
 * - **The module cache is process-wide**, keyed by `cacheKey`. A second test reusing an id finds the
 *   first test's module already loaded and never shows a fallback at all. Ids are unique per test.
 * - **`settle()` does not flush the promise chain** a module load runs on. It takes both, alternated
 *   — see `flush`.
 */
class Row extends Component<{ text: string }> {
  render() {
    return <b className="row">{this.props.text}</b>;
  }
}

/** How many times each id's module was ASKED for, which is what identity decides. */
const calls: Record<string, number> = {};
const resolvers: Record<string, (module: Record<string, unknown>) => void> = {};
const failers: Record<string, (reason: Error) => void> = {};
const lazies: Record<string, () => Promise<Record<string, unknown>>> = {};

/** One lazy function per id, kept across renders — see the note above. */
const lazyFor = (id: string) => {
  lazies[id] ??= () => {
    calls[id] = (calls[id] ?? 0) + 1;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      resolvers[id] = resolve;
      failers[id] = reject;
    });
  };
  return lazies[id];
};

const row = (id: string) => (
  <AsyncLoad
    key={id}
    lazy={lazyFor(id)}
    cacheKey={id}
    onLoading={<i className="wait">…</i>}
    errorFallback={<i className="err">failed</i>}
    loadedProps={{ text: id }}
  />
);

/** A shell that renders whatever slot it is handed, so the list lands somewhere else. */
class Panel extends Component<{ slot?: RamondaNode }> {
  render() {
    return <section className="panel">{this.props.slot}</section>;
  }
}

class Rows extends Component<{ ids: string[] }> {
  @state rows = this.props.ids.map((id) => ({ id }));
  render() {
    return <Panel slot={list(this.rows, (item) => row(item.id))} />;
  }
}

const shown = (root: Element) => ({
  waiting: root.querySelectorAll(".wait").length,
  failed: root.querySelectorAll(".err").length,
  rows: [...root.querySelectorAll(".row")].map((node) => node.textContent),
});

/** A module load runs on the promise chain, which `settle` alone does not drain. */
const flush = async (app: { settle: () => Promise<unknown> }) => {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
    await app.settle();
  }
};

describe("AsyncLoad in a list in a slot", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("each row loads on its own, and one arriving leaves the others waiting", async () => {
    const app = await getDOM<Rows>(<Rows ids={["a1", "a2"]} />);
    await app.settle();
    expect(shown(app.container)).toEqual({ waiting: 2, failed: 0, rows: [] });

    resolvers.a1({ default: Row });
    await flush(app);
    expect(shown(app.container)).toEqual({ waiting: 1, failed: 0, rows: ["a1"] });

    resolvers.a2({ default: Row });
    await flush(app);
    expect(shown(app.container)).toEqual({ waiting: 0, failed: 0, rows: ["a1", "a2"] });
  });

  /**
   * The row is gone before its module is. Its `AsyncLoad` was torn down mid-flight, so the promise
   * resolves into a component nobody is holding — and the row that is still there has to be
   * unaffected by that. The dropped module is delivered FIRST on purpose: if the arrival did
   * anything to the region as a whole, this is the order that would show it.
   */
  test("a row dropped mid-load leaves the survivor's load intact", async () => {
    const app = await getDOM<Rows>(<Rows ids={["b1", "b2"]} />);
    await app.settle();

    app.instance.rows = [{ id: "b1" }];
    await app.settle();
    expect(shown(app.container)).toEqual({ waiting: 1, failed: 0, rows: [] });

    resolvers.b2({ default: Row });
    resolvers.b1({ default: Row });
    await flush(app);

    expect(shown(app.container)).toEqual({ waiting: 0, failed: 0, rows: ["b1"] });
  });

  /**
   * Identity is what carries a pending load across a reorder. The rows swap places while both are
   * still in flight, and each module has to land in the row that asked for it — a load matched by
   * POSITION instead would put `c1`'s module in `c2`'s place, and both rows would look plausible.
   */
  test("a reorder mid-load keeps each module with its own row", async () => {
    const app = await getDOM<Rows>(<Rows ids={["c1", "c2"]} />);
    await app.settle();

    app.instance.rows = [{ id: "c2" }, { id: "c1" }];
    await app.settle();

    /**
     * The count is the assertion, and nothing on the page is.
     *
     * Every visible outcome here is the same under either identity: `AsyncLoad` is driven entirely
     * by its props, and props follow position, so a row rebuilt in the wrong place still shows the
     * right word — for the wrong reason. Measured with identity by position planted, the page was
     * identical and each module was requested TWICE, because each region was handed a different
     * `cacheKey` and started again. Once per row is the whole claim.
     */
    expect({ c1: calls.c1, c2: calls.c2 }).toEqual({ c1: 1, c2: 1 });

    resolvers.c1({ default: Row });
    await flush(app);
    expect(shown(app.container)).toEqual({ waiting: 1, failed: 0, rows: ["c1"] });

    resolvers.c2({ default: Row });
    await flush(app);
    expect(shown(app.container)).toEqual({ waiting: 0, failed: 0, rows: ["c2", "c1"] });
    expect({ c1: calls.c1, c2: calls.c2 }).toEqual({ c1: 1, c2: 1 });
  });

  /** One row failing is one row's fallback, not the region's. */
  test("a row that fails does not take its siblings with it", async () => {
    const app = await getDOM<Rows>(<Rows ids={["d1", "d2"]} />);
    await app.settle();

    failers.d1(new Error("boom"));
    resolvers.d2({ default: Row });
    await flush(app);

    expect(shown(app.container)).toEqual({ waiting: 0, failed: 1, rows: ["d2"] });
  });
});
