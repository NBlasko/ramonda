import { describe, test, expect, vi, beforeEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { Host, state } from "../base/decorators";
import { list } from "../base/list";

/**
 * Which row callbacks may be reused, and why the answer is the callback's own identity.
 *
 * A row is reused when nothing it READ has moved, and the tracker records every read the callback
 * makes — at any call depth, in any module. It is blind to one thing only: a value read OUTSIDE the
 * callback and closed over.
 *
 * ```tsx
 * const label = this.label;                    // read here
 * list(rows, () => <li>{label}</li>)            // the row tracks nothing, and never refreshes
 * ```
 *
 * Nothing can look inside a closure and enumerate what it captured. But a closure that COULD have
 * captured a render's locals is created in that render, so its reference is new; a callback that
 * cannot capture is written where a render cannot reach it, so its reference is stable. One identity
 * check therefore separates them, with nothing static and no guessing.
 *
 * Measured over three renders: a class method gives 1 distinct reference, a module-level function 1,
 * an inline arrow 3. And the cost of rebuilding, at 10 000 rows over five re-renders: the stable form
 * does 0 row builds and the inline form 50 000 — with **5 DOM writes each**. The diff finds the rows
 * equal and touches nothing, so the price is closures and small objects, never the document.
 */

interface Row {
  id: string;
}

const ROWS: Row[] = [{ id: "a" }, { id: "b" }];
const OUTER: Row[] = [{ id: "x" }];
const INNER: Row[] = [{ id: "1" }];

/** Module scope: reference-stable, and it cannot see anyone's render. */
let moduleCalls = 0;
const moduleRow = (row: Row) => {
  moduleCalls++;
  return <li class="m">{row.id}</li>;
};

describe("a row callback that CANNOT capture keeps the fast path", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));

  /**
   * Case 2 of the matrix: a stable callback subscribes the way a `@compute` does — it wakes on a
   * signal it read and sleeps through one it did not. This is the property the whole cache exists for,
   * and it must not have moved.
   */
  test("a METHOD wakes on the signal it reads and sleeps on the one it does not", async () => {
    let calls = 0;

    @Host("div")
    class App extends Component {
      @state label = "old";
      @state unrelated = 0;

      row(r: Row) {
        calls++;
        return <li id={`r-${r.id}`}>{this.label}</li>;
      }

      render() {
        return (
          <div>
            <ul>{list(ROWS, this.row)}</ul>
            <span id="u">{this.unrelated}</span>
          </div>
        );
      }
    }

    using app = await getDOM<App>(<App />);
    await app.settle();
    expect(calls).toBe(2);

    // A signal the rows never read: they must be left alone.
    app.instance.unrelated = 1;
    await app.settle();
    expect(calls).toBe(2);
    expect(document.getElementById("r-a")?.textContent).toBe("old");

    // The signal they DID read, inside the callback: they rebuild, with the new value.
    app.instance.label = "new";
    await app.settle();
    expect(calls).toBe(4);
    expect(document.getElementById("r-a")?.textContent).toBe("new");
  });

  /** A module-level function cannot capture a render either, so it gets the same treatment. */
  test("a MODULE-LEVEL function is reused too", async () => {
    @Host("div")
    class App extends Component {
      @state unrelated = 0;
      render() {
        return (
          <div>
            <ul>{list(ROWS, moduleRow)}</ul>
            <span id="u">{this.unrelated}</span>
          </div>
        );
      }
    }

    moduleCalls = 0;
    using app = await getDOM<App>(<App />);
    await app.settle();
    expect(moduleCalls).toBe(2);

    app.instance.unrelated = 1;
    await app.settle();
    expect(moduleCalls).toBe(2);
  });
});

describe("an INLINE row callback is rebuilt, so it cannot serve a stale capture", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));

  /**
   * Case 1 of the matrix, and the fault this was written for. The value is read in `render()` and
   * closed over, so the row tracks nothing — before this, it served `"old"` for the life of the list
   * while the same field outside the list read `"new"`.
   */
  test("a value read OUTSIDE the callback is not stale any more", async () => {
    @Host("div")
    class App extends Component {
      /** NOT `@state`, so there is nothing at all to track — the hardest version. */
      label = "old";
      @state tick = 0;

      render() {
        const captured = this.label;
        return (
          <div>
            <p id="outside">{this.label}</p>
            <ul>
              {list(ROWS, (r: Row) => (
                <li id={`r-${r.id}`}>{captured}</li>
              ))}
            </ul>
            <span id="t">{this.tick}</span>
          </div>
        );
      }
    }

    using app = await getDOM<App>(<App />);
    await app.settle();
    expect(document.getElementById("r-a")?.textContent).toBe("old");

    app.instance.label = "new";
    app.instance.tick = 1;
    await app.settle();

    // The row now agrees with the markup beside it, which is the whole point.
    expect(document.getElementById("outside")?.textContent).toBe("new");
    expect(document.getElementById("r-a")?.textContent).toBe("new");
  });

  /** And the cost is visible: an inline callback runs for every row on every render. */
  test("the price is paid in callback calls, not in correctness", async () => {
    let calls = 0;

    @Host("div")
    class App extends Component {
      @state unrelated = 0;
      render() {
        return (
          <div>
            <ul>
              {list(ROWS, (r: Row) => {
                calls++;
                return <li>{r.id}</li>;
              })}
            </ul>
            <span id="u">{this.unrelated}</span>
          </div>
        );
      }
    }

    using app = await getDOM<App>(<App />);
    await app.settle();
    expect(calls).toBe(2);

    // A signal the rows do not read still rebuilds them — that is the trade, and it is deliberate.
    app.instance.unrelated = 1;
    await app.settle();
    expect(calls).toBe(4);
  });
});

/**
 * NESTED lists — the four combinations Nikola asked for, and the case with the real risk.
 *
 * An inner `list()` is built INSIDE the outer row callback, so while it builds, the outer row's scope
 * is the current tracker (`buildItem` restores rather than nulls it, precisely so a nested build's
 * reads still reach the tracker above). Each combination has to be separately true, because the two
 * decisions are made by two different engines with two different `lastBuilder`s.
 *
 * The assertion in each is the same and is the one that matters: a value read outside a callback must
 * not go stale, and a callback that cannot capture must not lose its reuse.
 */
describe("nested lists, every combination of stable and inline", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));

  /** Both inline: neither can be reused, and neither may be stale. */
  test("BOTH inline — nothing stale", async () => {
    @Host("div")
    class App extends Component {
      label = "old";
      @state tick = 0;
      render() {
        const captured = this.label;
        return (
          <div>
            <ul>
              {list(OUTER, (_o: Row) => (
                <li>
                  <ul>
                    {list(INNER, (i: Row) => (
                      <span id={`b-x${i.id}`}>{captured}</span>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            <span id="t">{this.tick}</span>
          </div>
        );
      }
    }

    using app = await getDOM<App>(<App />);
    await app.settle();
    expect(document.getElementById("b-x1")?.textContent).toBe("old");

    app.instance.label = "new";
    app.instance.tick = 1;
    await app.settle();
    expect(document.getElementById("b-x1")?.textContent).toBe("new");
  });

  /**
   * Both stable: both keep the fast path, and the inner reads its signal INSIDE, so it still wakes.
   * The inner callback is a method, so it is one function shared by every outer row — which is fine,
   * because each inner engine keeps its own `lastBuilder`.
   */
  test("BOTH stable — reuse kept, and a signal read inside still wakes the row", async () => {
    let inner = 0;

    @Host("div")
    class App extends Component {
      @state label = "old";
      @state unrelated = 0;

      innerRow(i: Row) {
        inner++;
        return <span id={`s-${i.id}`}>{this.label}</span>;
      }
      outerRow(_o: Row) {
        return (
          <li>
            <ul>{list(INNER, this.innerRow)}</ul>
          </li>
        );
      }

      render() {
        return (
          <div>
            <ul>{list(OUTER, this.outerRow)}</ul>
            <span id="u">{this.unrelated}</span>
          </div>
        );
      }
    }

    using app = await getDOM<App>(<App />);
    await app.settle();
    expect(inner).toBe(1);

    // Untouched by a signal neither callback reads.
    app.instance.unrelated = 1;
    await app.settle();
    expect(inner).toBe(1);

    // The inner read `label` inside itself, so it wakes.
    app.instance.label = "new";
    await app.settle();
    expect(document.getElementById("s-1")?.textContent).toBe("new");
  });

  /**
   * Only the OUTER is stable.
   *
   * The outer method reads the signal INSIDE itself, so the outer row is tracked and invalidated, and
   * rebuilding it rebuilds the inner list with it. That chain is what this pins: an inline INNER
   * callback must not hold a value the outer callback captured on an earlier pass.
   *
   * Written with `@state` deliberately. With a PLAIN field here the outer row is never invalidated at
   * all — nothing tracks a plain field — and the inner never runs again. That is not this fix's
   * business and it is not a list quirk: a `@compute` reading a plain field caches it forever too, and
   * a stable method IS the cached thing. It is pinned separately below.
   */
  test("only the OUTER stable — the inner is still not stale", async () => {
    @Host("div")
    class App extends Component {
      @state label = "old";
      @state tick = 0;

      outerRow(o: Row) {
        // Read INSIDE the outer callback, then handed to an inline inner one.
        const captured = this.label;
        return (
          <li>
            <ul>
              {list(INNER, (i: Row) => (
                <span id={`o-${o.id}${i.id}`}>{captured}</span>
              ))}
            </ul>
          </li>
        );
      }

      render() {
        return (
          <div>
            <ul>{list(OUTER, this.outerRow)}</ul>
            <span id="t">{this.tick}</span>
          </div>
        );
      }
    }

    using app = await getDOM<App>(<App />);
    await app.settle();
    expect(document.getElementById("o-x1")?.textContent).toBe("old");

    app.instance.label = "new";
    app.instance.tick = 1;
    await app.settle();
    expect(document.getElementById("o-x1")?.textContent).toBe("new");
  });

  /** Only the INNER is stable: the outer is rebuilt every render, and the inner must keep up. */
  test("only the INNER stable — the outer rebuilds and the inner follows", async () => {
    @Host("div")
    class App extends Component {
      @state label = "old";
      @state tick = 0;

      innerRow(i: Row) {
        return <span id={`i-${i.id}`}>{this.label}</span>;
      }

      render() {
        return (
          <div>
            <ul>
              {list(OUTER, (_o: Row) => (
                <li>
                  <ul>{list(INNER, this.innerRow)}</ul>
                </li>
              ))}
            </ul>
            <span id="t">{this.tick}</span>
          </div>
        );
      }
    }

    using app = await getDOM<App>(<App />);
    await app.settle();
    expect(document.getElementById("i-1")?.textContent).toBe("old");

    app.instance.label = "new";
    app.instance.tick = 1;
    await app.settle();
    expect(document.getElementById("i-1")?.textContent).toBe("new");
  });
});

/**
 * The one thing this does NOT fix, pinned so it is a decision rather than a surprise.
 *
 * A STABLE callback reading a PLAIN field — not a signal — still serves the first value. Nothing
 * tracks a plain field, so the row is never invalidated and the callback is never called again.
 *
 * That is not a list quirk and it is not the divergence this was written for. A `@compute` reading a
 * plain field caches it forever in exactly the same way, and a stable row callback IS the cached
 * thing. **The inconsistency that mattered is gone:** the same code with an INLINE callback now agrees
 * with the markup beside it (the first test in this file), because an inline callback is rebuilt.
 *
 * So the rule is one sentence and holds everywhere: a value a cached callback should follow has to be
 * `@state` or `@compute`.
 */
describe("the boundary: a plain field is untrackable, in a list as anywhere else", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));

  test("a stable callback reading a plain field keeps the first value, like a @compute would", async () => {
    @Host("div")
    class App extends Component {
      /** Not `@state` — nothing to subscribe to. */
      label = "old";
      @state tick = 0;

      row(r: Row) {
        return <li id={`p-${r.id}`}>{this.label}</li>;
      }

      render() {
        return (
          <div>
            <p id="outside">{this.label}</p>
            <ul>{list(ROWS, this.row)}</ul>
            <span id="t">{this.tick}</span>
          </div>
        );
      }
    }

    using app = await getDOM<App>(<App />);
    await app.settle();

    app.instance.label = "new";
    app.instance.tick = 1;
    await app.settle();

    // The markup re-reads it, because `render()` always runs.
    expect(document.getElementById("outside")?.textContent).toBe("new");
    // The cached row does not, and that is the documented behaviour of a cache over a non-signal.
    expect(document.getElementById("p-a")?.textContent).toBe("old");
  });
});
