import { describe, test, expect, vi, beforeEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { Host, state, memoizedHandler } from "../base/decorators";

/**
 * What a memoized handler is allowed to remember.
 *
 * The cache is keyed by the ARGUMENTS, so the method runs once per key and never again — and whatever
 * it read on that one call is closed into the handler and frozen. Measured before this was fixed: a
 * method reading `this.prefix` before returning its closure served `"old"` on every click for the life
 * of the page, while `prefix` already said `"new"`. Nothing reported it.
 *
 * So the builder now runs inside a tracker and a change to anything it read drops that entry — the
 * same mechanism `@compute` and a list row use. Two properties have to hold together, and one of them
 * is easy to lose:
 *
 * 1. a handler whose builder read a signal is rebuilt when that signal moves;
 * 2. a handler whose builder read NOTHING keeps its identity for ever, which is the decorator's whole
 *    purpose — a new function on every render is exactly what it exists to prevent.
 */
describe("a memoized handler whose builder read a signal", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));

  test("is rebuilt when that signal moves, and the click sees the new value", async () => {
    const seen: string[] = [];

    @Host("div")
    class App extends Component {
      @state prefix = "old";
      @state tick = 0;

      /** Reads `prefix` BEFORE returning the closure — the read the cache used to freeze. */
      @memoizedHandler
      pick(id: string) {
        const captured = this.prefix;
        return () => seen.push(`${captured}:${id}`);
      }

      render() {
        return (
          <div>
            <button type="button" id="b" onclick={this.pick("a")}>
              go
            </button>
            <span id="t">{this.tick}</span>
          </div>
        );
      }
    }

    using app = await getDOM<App>(<App />);
    await app.settle();
    document.getElementById("b")?.click();

    app.instance.prefix = "new";
    app.instance.tick = 1;
    await app.settle();
    document.getElementById("b")?.click();

    expect(seen).toEqual(["old:a", "new:a"]);
  });

  /**
   * Nikola's own example, and the reason the deps live on the ENTRY rather than on the map.
   *
   * `pick(1)` reads nothing, `pick(2)` reads the signal. When the signal moves, only `pick(2)` may be
   * rebuilt. Wiping the whole map would satisfy the first assertion and fail the second — a new
   * identity for a handler that cannot have changed, and every child holding it re-rendering for
   * nothing.
   */
  test("only the entry that read it is dropped — the others keep their identity", async () => {
    let one!: () => void;
    let two!: () => void;

    @Host("div")
    class App extends Component {
      @state mode = "m1";
      @state tick = 0;

      @memoizedHandler
      pick(id: number) {
        let val = "none";
        if (id === 2) {
          val = this.mode;
        }
        return () => `${id}:${val}`;
      }

      render() {
        one = this.pick(1);
        two = this.pick(2);
        return <span id="t">{this.tick}</span>;
      }
    }

    using app = await getDOM<App>(<App />);
    await app.settle();
    const firstOne = one;
    const firstTwo = two;
    expect((firstTwo as unknown as () => string)()).toBe("2:m1");

    app.instance.mode = "m2";
    await app.settle();

    // The one that read it: a new function, with the new value.
    expect(two).not.toBe(firstTwo);
    expect((two as unknown as () => string)()).toBe("2:m2");
    // The one that read nothing: the very same function.
    expect(one).toBe(firstOne);
  });
});

describe("a memoized handler whose builder read nothing", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));

  /**
   * The documented shape, and the property the decorator exists for. Nothing is tracked here, so
   * nothing is ever dropped — the handler is the same function across every render, however much
   * state moves around it.
   */
  test("keeps the same function across renders, whatever else changes", async () => {
    const handlers: Array<() => void> = [];

    @Host("div")
    class App extends Component {
      @state tick = 0;
      @state unrelated = "a";
      @state selected = "";

      @memoizedHandler
      pick(id: string) {
        return () => {
          this.selected = id;
        };
      }

      render() {
        handlers.push(this.pick("row-1"));
        return (
          <div>
            <span id="t">{this.tick}</span>
            <span id="u">{this.unrelated}</span>
          </div>
        );
      }
    }

    using app = await getDOM<App>(<App />);
    await app.settle();

    app.instance.tick = 1;
    await app.settle();
    app.instance.unrelated = "b";
    await app.settle();
    app.instance.selected = "row-1";
    await app.settle();

    expect(handlers.length).toBeGreaterThan(3);
    expect(new Set(handlers).size).toBe(1);
  });
});
