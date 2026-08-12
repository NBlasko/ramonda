import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, list, state, compute } from "../index";

/**
 * Each item's mapper runs inside its own tracker, so the signals it reads are
 * recorded against that item. On the next render an item whose object is
 * unchanged and whose signals are unchanged reuses last render's vnode, and the
 * diff keeps its DOM node without walking into it.
 *
 * These assert CALL COUNTS, not durations. The counts are the invariant; the
 * milliseconds depend on the machine.
 */

interface Row {
  id: number;
  value: string;
}

let mapperCalls = 0;

@Host("li")
class Item extends Component<{ row: Row; mark?: string }> {
  render() {
    return (
      <span>
        {this.props.row.value}
        {this.props.mark ?? ""}
      </span>
    );
  }
}

const dump = (c: Element) =>
  Array.from(c.querySelectorAll("li"))
    .map((li) => li.textContent)
    .join(",");

@Host("div")
class Plain extends Component {
  @state rows: Row[] = [
    { id: 1, value: "a" },
    { id: 2, value: "b" },
    { id: 3, value: "c" },
  ];
  @state unrelated = 0;
  render() {
    return (
      <ul>
        {list(this.rows, (row: Row) => {
            mapperCalls++;
            return <Item row={row} />;
          })}
      </ul>
    );
  }
}

@Host("div")
class Selecting extends Component {
  @state rows: Row[] = [
    { id: 1, value: "a" },
    { id: 2, value: "b" },
    { id: 3, value: "c" },
  ];
  @state selected = 1;
  render() {
    return (
      <ul>
        {list(this.rows, (row: Row) => {
            mapperCalls++;
            // Reads a signal beyond the item — the case that makes naive vnode
            // caching unsafe, and the reason the mapper runs inside a tracker.
            return <Item row={row} mark={row.id === this.selected ? "*" : ""} />;
          })}
      </ul>
    );
  }
}

describe("per-item reactive scopes", () => {
  beforeEach(() => {
    mapperCalls = 0;
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  test("a state the mapper never reads re-runs nothing", async () => {
    const app = await getDOM<Plain>(<Plain />);
    await app.settle();
    expect(mapperCalls).toBe(3);

    mapperCalls = 0;
    app.instance.unrelated = 99;
    await app.settle();

    expect(mapperCalls).toBe(0);
    expect(dump(app.container)).toBe("a,b,c");
  });

  test("replacing one item re-runs only that item", async () => {
    const app = await getDOM<Plain>(<Plain />);
    await app.settle();

    mapperCalls = 0;
    app.instance.rows = app.instance.rows.map((r) => (r.id === 2 ? { ...r, value: "B!" } : r));
    await app.settle();

    expect(mapperCalls).toBe(1);
    expect(dump(app.container)).toBe("a,B!,c");
  });

  test("a signal the mapper DID read re-runs every item that read it", async () => {
    const app = await getDOM<Selecting>(<Selecting />);
    await app.settle();
    expect(dump(app.container)).toBe("a*,b,c");

    mapperCalls = 0;
    app.instance.selected = 3;
    await app.settle();

    // Correctness first: the marker has to move, or the cache is lying.
    expect(dump(app.container)).toBe("a,b,c*");
    expect(mapperCalls).toBe(3);
  });

  test("a signal read through a @compute still invalidates the item", async () => {
    // A cached @compute touches no State when read, so without the getter
    // replaying its deps the item's scope would record nothing and go stale.
    @Host("div")
    class ViaCompute extends Component {
      @state rows: Row[] = [{ id: 1, value: "a" }];
      @state suffix = "x";
      @compute get loud() {
        return this.suffix.toUpperCase();
      }
      render() {
        return (
          <ul>
            {list(this.rows, (row: Row) => {
                mapperCalls++;
                return <Item row={row} mark={this.loud} />;
              })}
          </ul>
        );
      }
    }

    const app = await getDOM<ViaCompute>(<ViaCompute />);
    await app.settle();
    expect(dump(app.container)).toBe("aX");

    mapperCalls = 0;
    app.instance.suffix = "y";
    await app.settle();

    expect(dump(app.container)).toBe("aY");
    expect(mapperCalls).toBe(1);
  });
});

/**
 * The other half of the contract: what per-item scopes deliberately do NOT see.
 *
 * Both of these are accepted trade-offs, not defects ("A non-signal
 * field read inside a list mapper never invalidates the item"). They are locked
 * so that changing either is a decision someone has to make on purpose, rather
 * than a side effect of touching the engine.
 *
 * The behaviour CHANGED when per-item scopes arrived: before them the mapper ran
 * on every render, so any unrelated render happened to pick these up. That was
 * accidental rescue, not a guarantee.
 */
describe("what the scopes deliberately do not track", () => {
  beforeEach(() => {
    mapperCalls = 0;
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  test("a plain field is not a signal, so writing it reaches no item", async () => {
    @Host("div")
    class App extends Component {
      @state rows: Row[] = [
        { id: 1, value: "a" },
        { id: 2, value: "b" },
      ];
      @state tick = 0;
      mode = "compact"; // deliberately NOT @state
      render() {
        return (
          <ul data-tick={String(this.tick)}>
            {list(this.rows, (row: Row) => <Item row={row} mark={`-${this.mode}`} />)}
          </ul>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();
    expect(dump(app.container)).toBe("a-compact,b-compact");

    app.instance.mode = "wide";
    // Even an unrelated re-render does not rescue it — the whole-list skip means
    // the items are never looked at.
    app.instance.tick++;
    await app.settle();

    expect(dump(app.container)).toBe("a-compact,b-compact");
    expect(app.container.querySelector("ul")!.getAttribute("data-tick")).toBe("1");
  });

  test("mutating an item in place is not recovered by a new array, only a new item", async () => {
    // The likelier version of the same mistake, and the reason it is worth a
    // test: the array is `===` what it was, so the whole-list skip applies and
    // not one item is examined.
    @Host("div")
    class App extends Component {
      @state rows: Row[] = [
        { id: 1, value: "a" },
        { id: 2, value: "b" },
      ];
      @state tick = 0;
      render() {
        return (
          <ul data-tick={String(this.tick)}>{list(this.rows, (row: Row) => <Item row={row} />)}</ul>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    app.instance.rows[0].value = "MUTATED";
    app.instance.tick++;
    await app.settle();

    expect(dump(app.container)).toBe("a,b");

    // A new ARRAY does not rescue it either, which is the part worth locking:
    // identity is the ITEM, and these are the same item objects with clean
    // scopes, so their cached vnodes are still considered valid.
    app.instance.rows = [...app.instance.rows];
    await app.settle();
    expect(dump(app.container)).toBe("a,b");

    // Replacing the item OBJECT is the only thing that recovers — and it is
    // exactly what an immutable update produces.
    app.instance.rows = app.instance.rows.map((r) => ({ ...r }));
    await app.settle();
    expect(dump(app.container)).toBe("MUTATED,b");
  });
});
