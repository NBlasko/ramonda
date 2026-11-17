import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, state, memoized } from "../index";
import { State } from "../reactivity/State";

/**
 * What `@memoized` does with an argument it cannot build a cache key from.
 *
 * A key can hold a string, a number or a boolean. An object cannot: comparing it
 * by value is not something the cache can do, and keying on its identity would
 * miss every time — a fresh object per render would fill the map and hand back a
 * new handler on every pass, which is the exact churn the decorator exists to
 * prevent. So the argument is a mistake, and development stops at it.
 *
 * Production does not, and the split is deliberate: it used to throw there too,
 * from inside a render, so one handler receiving an object took the whole page
 * down. `MemoizedKey.prod.test.tsx` is the other half of this pair.
 */
describe("@memoized with an un-keyable argument", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("it is reported as RMD047 as well as thrown, so it can be swept for", async () => {
    /**
     * The same shape a props write has (RMD004, RMD015): the throw stops the
     * mistake being shipped, and the diagnostic makes it an identifiable thing —
     * one code to grep for, one entry in the stream the panel carries, so a
     * codebase can be swept for a class of fault rather than for a sentence
     * somebody has to recognise.
     */
    const logged: string[] = [];
    (console.log as unknown as { mockRestore?: () => void }).mockRestore?.();
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });

    class Panel extends Component {
      @memoized
      pick(row: unknown) {
        return () => row;
      }
      render() {
        return (
          <div>
            <button onclick={this.pick({ id: 7 } as unknown as string)}>x</button>
          </div>
        );
      }
    }

    await expect(getDOM(<Panel />)).rejects.toThrow(/\[RMD047\]/);
    expect(logged.filter((line) => line.includes("RMD047")).length).toBeGreaterThan(0);
  });

  test("development throws, naming the method and the argument", async () => {
    class Panel extends Component {
      @memoized
      pick(row: unknown) {
        return () => row;
      }

      render() {
        return (
          <div>
            <button onclick={this.pick({ id: 7 } as unknown as string)}>x</button>
          </div>
        );
      }
    }

    // The message has to carry three things, or it is the old one with more words:
    // whose handler it is, which argument, and what to do instead.
    await expect(getDOM(<Panel />)).rejects.toThrow(/@memoized on Panel\.pick/);
    await expect(getDOM(<Panel />)).rejects.toThrow(/#1 \(object\)/);
    await expect(getDOM(<Panel />)).rejects.toThrow(/row\.id.*rather than.*row/);
  });

  test("it names the position of the offending argument among several", async () => {
    class Panel extends Component {
      @memoized
      pick(_a: string, _b: number, _c: unknown) {
        return () => null;
      }

      render() {
        return (
          <div>
            <button onclick={this.pick("a", 1, [] as unknown as string)}>x</button>
          </div>
        );
      }
    }

    await expect(getDOM(<Panel />)).rejects.toThrow(/#3 \(object\)/);
  });

  test("null is named as null rather than as an object", async () => {
    class Panel extends Component {
      @memoized
      pick(_row: unknown) {
        return () => null;
      }

      render() {
        return (
          <div>
            <button onclick={this.pick(null as unknown as string)}>x</button>
          </div>
        );
      }
    }

    await expect(getDOM(<Panel />)).rejects.toThrow(/#1 \(null\)/);
  });

  test("keyable arguments are unaffected — the same handler comes back", async () => {
    class Panel extends Component {
      @state tick = 0;
      seen: unknown[] = [];

      @memoized
      pick(id: string, on: boolean, n: number) {
        return () => `${id}${on}${n}`;
      }

      render() {
        this.seen.push(this.pick("a", true, 1));
        return (
          <div>
            <div>{this.tick}</div>
          </div>
        );
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
    class Panel extends Component {
      @memoized
      pick(id: string) {
        return () => id;
      }

      render() {
        return (
          <div>
            <div>
              <button id="a" onclick={this.pick("a")}>
                a
              </button>
              <button id="b" onclick={this.pick("b")}>
                b
              </button>
            </div>
          </div>
        );
      }
    }

    const app = await getDOM<Panel>(<Panel />);
    await app.settle();

    const a = app.container.querySelector("#a") as HTMLButtonElement & { _listeners?: Record<string, unknown> };
    const b = app.container.querySelector("#b") as HTMLButtonElement & { _listeners?: Record<string, unknown> };
    expect(a._listeners?.onclick).not.toBe(b._listeners?.onclick);
  });
});

/**
 * Two `@memoized` methods on one component, called with the same argument.
 *
 * The cache is one map per INSTANCE, shared by every memoized method on it, and the key used to be built
 * from the arguments alone — so two methods collided. Measured before the member's name went into the
 * key: `removeFor(1) === editFor(1)`, and calling the second ran the FIRST one's body. Twice
 * `remove:1`, no diagnostic, nothing thrown.
 *
 * It is the commonest shape there is in a list row: several per-item handlers keyed by the same id. It
 * was found by building a playground page with three buttons per row and watching all three do the same
 * thing.
 */
describe("two memoized methods on one component", () => {
  test("the same argument does not make them the same handler", async () => {
    const calls: string[] = [];

    class Panel extends Component {
      @memoized
      removeFor(id: number) {
        return () => calls.push(`remove:${id}`);
      }

      @memoized
      editFor(id: number) {
        return () => calls.push(`edit:${id}`);
      }

      render() {
        return <div />;
      }
    }

    using app = await getDOM<Panel>(<Panel />);
    const remove = app.instance.removeFor(1);
    const edit = app.instance.editFor(1);

    expect(remove).not.toBe(edit);
    remove();
    edit();
    expect(calls).toEqual(["remove:1", "edit:1"]);
  });

  test("each is still memoised, per member and per argument", async () => {
    class Panel extends Component {
      @memoized
      a(id: number) {
        return () => id;
      }

      @memoized
      b(id: number) {
        return () => id;
      }

      render() {
        return <div />;
      }
    }

    using app = await getDOM<Panel>(<Panel />);
    expect(app.instance.a(1)).toBe(app.instance.a(1));
    expect(app.instance.b(1)).toBe(app.instance.b(1));
    expect(app.instance.a(1)).not.toBe(app.instance.a(2));
  });

  /**
   * Two symbols with the same DESCRIPTION are two members, and the first fix did not see it.
   *
   * Keying by `String(context.name)` renders both as `"Symbol(pick)"`, so they collided exactly the way
   * two named methods did — the same fault, one shape over. The key carries a token minted per decorated
   * method instead, which a name cannot be.
   */
  test("two symbol-named methods whose symbols share a description", async () => {
    const calls: string[] = [];
    const A = Symbol("pick");
    const B = Symbol("pick");

    class Panel extends Component {
      @memoized
      [A](id: number) {
        return () => calls.push(`A:${id}`);
      }

      @memoized
      [B](id: number) {
        return () => calls.push(`B:${id}`);
      }

      render() {
        return <div />;
      }
    }

    using app = await getDOM<Panel>(<Panel />);
    const reach = app.instance as unknown as Record<symbol, (n: number) => () => void>;
    const a = reach[A](1);
    const b = reach[B](1);

    expect(a).not.toBe(b);
    a();
    b();
    expect(calls).toEqual(["A:1", "B:1"]);
  });

  /** A caller's own string goes straight into the key, so the separator has to be one they cannot type. */
  test("an argument that spells another member's name does not collide with it", async () => {
    const calls: string[] = [];

    class Panel extends Component {
      @memoized
      remove(id: string) {
        return () => calls.push(`remove:${id}`);
      }

      @memoized
      edit(id: string) {
        return () => calls.push(`edit:${id}`);
      }

      render() {
        return <div />;
      }
    }

    using app = await getDOM<Panel>(<Panel />);
    app.instance.edit("remove")();
    app.instance.remove("edit")();
    expect(calls).toEqual(["edit:remove", "remove:edit"]);
  });
});

/**
 * A call with one string, number or boolean is looked up by that value itself, and any other call by a key
 * built from its arguments, in a table of its own. Both tell a value from its spelling as text.
 */
describe("what a handler is looked up by", () => {
  test("a number, a boolean and the same thing spelled as text are three keys", async () => {
    class Panel extends Component {
      @memoized
      pick(value: string | number | boolean) {
        return () => value;
      }
      render() {
        return <div />;
      }
    }
    using app = await getDOM<Panel>(<Panel />);
    const panel = app.instance;
    expect([panel.pick(5)(), panel.pick("5")(), panel.pick(true)(), panel.pick("true")()]).toEqual([
      5,
      "5",
      true,
      "true",
    ]);
  });

  test("one string that spells a built key is not the call it spells", async () => {
    class Panel extends Component {
      @memoized
      pick(...parts: (string | number)[]) {
        return () => parts.join("+");
      }
      render() {
        return <div />;
      }
    }
    using app = await getDOM<Panel>(<Panel />);
    const panel = app.instance;
    // `("a", 1)` is keyed `s:a|n:1`; the one string below spells exactly that.
    expect([panel.pick("a", 1)(), panel.pick("s:a|n:1")()]).toEqual(["a+1", "s:a|n:1"]);
  });
});

describe("a handler no render asked for", () => {
  test("is let go after a commit without it, and built afresh when asked for again — one argument or two", async () => {
    const seen: (() => number)[] = [];
    const pairs: (() => string)[] = [];
    class Rows extends Component {
      @state shown = true;
      @memoized
      pick(id: number) {
        return () => id;
      }
      @memoized
      pair(id: number, part: string) {
        return () => `${id}${part}`;
      }
      render() {
        if (this.shown) seen.push(this.pick(7));
        if (this.shown) pairs.push(this.pair(7, "a"));
        return <div>{this.shown ? "yes" : "no"}</div>;
      }
    }
    const app = await getDOM<Rows>(<Rows />);
    await app.settle();
    app.instance.shown = false;
    await app.settle();
    app.instance.shown = true;
    await app.settle();
    expect({ one: seen[0] === seen[seen.length - 1], two: pairs[0] === pairs[pairs.length - 1] }).toEqual({
      one: false,
      two: false,
    });
  });
});

describe("a component that goes away", () => {
  test("lets go of what its handlers' builders read — one argument or two", async () => {
    // A signal outside the component: its listeners are what a handler's builder left on it.
    const shared = new State(0);
    const listeners = () => (shared as unknown as { _listeners?: Map<unknown, unknown> })._listeners?.size ?? 0;
    class Row extends Component {
      @memoized
      pick(id: number) {
        const offset = shared.get();
        return () => id + offset;
      }
      @memoized
      pair(id: number, part: string) {
        const offset = shared.get();
        return () => `${id + offset}${part}`;
      }
      render() {
        return (
          <p>
            <a onclick={this.pick(1)}>one</a>
            <a onclick={this.pair(1, "a")}>two</a>
          </p>
        );
      }
    }
    class Page extends Component {
      @state shown = true;
      render() {
        return <div>{this.shown ? <Row /> : null}</div>;
      }
    }
    const app = await getDOM<Page>(<Page />);
    await app.settle();
    const held = listeners();
    app.instance.shown = false;
    await app.settle();
    expect({ held: held > 0, left: listeners() }).toEqual({ held: true, left: 0 });
  });
});

describe("@memoized with more than one argument", () => {
  test("keeps two calls apart whatever their strings hold — no text passes for the edge between two", async () => {
    const seen: string[] = [];
    class Picker extends Component {
      @memoized
      pick(first: string, second: string) {
        return () => seen.push(`${first} + ${second}`);
      }
      render() {
        return (
          <div>
            <button id="one" onclick={this.pick("a|s:b", "c")}>
              one
            </button>
            <button id="two" onclick={this.pick("a", "b|s:c")}>
              two
            </button>
          </div>
        );
      }
    }
    const app = await getDOM<Picker>(<Picker />);
    await app.settle();
    (app.container.querySelector("#one") as HTMLElement).click();
    (app.container.querySelector("#two") as HTMLElement).click();
    expect(seen).toEqual(["a|s:b + c", "a + b|s:c"]);
  });
});
