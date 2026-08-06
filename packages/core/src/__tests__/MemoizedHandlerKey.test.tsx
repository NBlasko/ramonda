import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, state, memoizedHandler } from "../index";

/**
 * What `@memoizedHandler` does with an argument it cannot build a cache key from.
 *
 * A key can hold a string, a number or a boolean. An object cannot: comparing it
 * by value is not something the cache can do, and keying on its identity would
 * miss every time — a fresh object per render would fill the map and hand back a
 * new handler on every pass, which is the exact churn the decorator exists to
 * prevent. So the argument is a mistake, and development stops at it.
 *
 * Production does not, and the split is deliberate: it used to throw there too,
 * from inside a render, so one handler receiving an object took the whole page
 * down. `MemoizedHandlerKey.prod.test.tsx` is the other half of this pair.
 */
describe("@memoizedHandler with an un-keyable argument", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("development throws, naming the method and the argument", async () => {
    @Host("div")
    class Panel extends Component {
      @memoizedHandler
      pick(row: unknown) {
        return () => row;
      }

      render() {
        return <button onClick={this.pick({ id: 7 } as unknown as string)}>x</button>;
      }
    }

    // The message has to carry three things, or it is the old one with more words:
    // whose handler it is, which argument, and what to do instead.
    await expect(getDOM(<Panel />)).rejects.toThrow(/@memoizedHandler on Panel\.pick/);
    await expect(getDOM(<Panel />)).rejects.toThrow(/#1 \(object\)/);
    await expect(getDOM(<Panel />)).rejects.toThrow(/row\.id.*rather than.*row/);
  });

  test("it names the position of the offending argument among several", async () => {
    @Host("div")
    class Panel extends Component {
      @memoizedHandler
      pick(_a: string, _b: number, _c: unknown) {
        return () => null;
      }

      render() {
        return <button onClick={this.pick("a", 1, [] as unknown as string)}>x</button>;
      }
    }

    await expect(getDOM(<Panel />)).rejects.toThrow(/#3 \(object\)/);
  });

  test("null is named as null rather than as an object", async () => {
    @Host("div")
    class Panel extends Component {
      @memoizedHandler
      pick(_row: unknown) {
        return () => null;
      }

      render() {
        return <button onClick={this.pick(null as unknown as string)}>x</button>;
      }
    }

    await expect(getDOM(<Panel />)).rejects.toThrow(/#1 \(null\)/);
  });

  test("keyable arguments are unaffected — the same handler comes back", async () => {
    @Host("div")
    class Panel extends Component {
      @state tick = 0;
      seen: unknown[] = [];

      @memoizedHandler
      pick(id: string, on: boolean, n: number) {
        return () => `${id}${on}${n}`;
      }

      render() {
        this.seen.push(this.pick("a", true, 1));
        return <div>{this.tick}</div>;
      }
    }

    const app = await getDOM<Panel>(<Panel />);
    await app.settle();

    app.instance.tick = 1;
    await app.settle();

    expect(app.instance.seen.length).toBe(2);
    expect(app.instance.seen[0]).toBe(app.instance.seen[1]);
  });

  test("different keyable arguments get different handlers", async () => {
    @Host("div")
    class Panel extends Component {
      @memoizedHandler
      pick(id: string) {
        return () => id;
      }

      render() {
        return (
          <div>
            <button id="a" onClick={this.pick("a")}>
              a
            </button>
            <button id="b" onClick={this.pick("b")}>
              b
            </button>
          </div>
        );
      }
    }

    const app = await getDOM<Panel>(<Panel />);
    await app.settle();

    const a = app.container.querySelector("#a") as HTMLButtonElement & { _listeners?: Record<string, unknown> };
    const b = app.container.querySelector("#b") as HTMLButtonElement & { _listeners?: Record<string, unknown> };
    expect(a._listeners?.click).not.toBe(b._listeners?.click);
  });
});
