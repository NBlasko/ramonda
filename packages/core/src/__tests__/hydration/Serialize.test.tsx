import { describe, test, expect } from "vitest";
import { getDOM } from "../../test/setup";
import { state, persist } from "../../base/decorators";
import { Component } from "../../base/Component";
import { Hook } from "../../base/Hook";
import { serializeComponentTree, serializeComponentToJSON } from "../../hydration/serialize";

describe("hydration: state serialization", () => {
  test("serializes @state and @persist, reflecting current values", async () => {
    class Widget extends Component {
      @state count = 0;
      @persist token = "abc";
      render() {
        return <div>{this.count}</div>;
      }
    }

    const app = await getDOM<Widget>(<Widget />);
    app.instance.count = 5;
    app.instance.token = "xyz";
    await app.settle();

    // BOTH are written before this, on purpose: a field still holding what its own initializer
    // produced is deliberately left out (see the omission test at the bottom), so asserting an
    // untouched field here would be asserting the absence of the saving rather than serialization.
    const tree = serializeComponentTree(app.instance);
    expect(tree.state).toEqual({ count: 5, token: "xyz" });
    expect(tree.hooks).toBeUndefined();
  });

  test("recurses into hooks and hooks-of-hooks in use() order", async () => {
    class Inner extends Hook {
      @state deep = 1;
    }
    class Outer extends Hook {
      inner = this.use(Inner);
      @state mid = 2;
    }
    class Root extends Component {
      outer = this.use(Outer);
      @state top = 3;
      render() {
        return <div>x</div>;
      }
    }

    const app = await getDOM<Root>(<Root />);
    // Moved off their initial values so each level has something to carry — the nesting is what is
    // under test, and an untouched primitive is not serialized at all.
    app.instance.top = 30;
    app.instance.outer.mid = 20;
    app.instance.outer.inner.deep = 10;
    await app.settle();
    const tree = serializeComponentTree(app.instance);

    expect(tree.state).toEqual({ top: 30 });
    expect(tree.hooks).toHaveLength(1);
    expect(tree.hooks![0].state).toEqual({ mid: 20 });
    expect(tree.hooks![0].hooks).toHaveLength(1);
    expect(tree.hooks![0].hooks![0].state).toEqual({ deep: 10 });
  });

  test("multiple hooks are serialized in the order they were used", async () => {
    class A extends Hook {
      @state a = "a";
    }
    class B extends Hook {
      @state b = "b";
    }
    class Root extends Component {
      first = this.use(A);
      second = this.use(B);
      render() {
        return <div>x</div>;
      }
    }

    const app = await getDOM<Root>(<Root />);
    app.instance.first.a = "A";
    app.instance.second.b = "B";
    await app.settle();
    const tree = serializeComponentTree(app.instance);

    expect(tree.hooks?.map((h) => h.state)).toEqual([{ a: "A" }, { b: "B" }]);
  });

  test("produces valid JSON and drops non-serializable values", async () => {
    class Widget extends Component {
      @state ok = 1;
      // A function is not serializable — must be dropped, not throw.
      @persist handler = () => 42;
      render() {
        return <div>x</div>;
      }
    }

    const app = await getDOM<Widget>(<Widget />);
    app.instance.ok = 2;
    await app.settle();
    const parsed = JSON.parse(serializeComponentToJSON(app.instance));

    expect(parsed.state.ok).toBe(2);
    expect("handler" in parsed.state).toBe(false);
  });

  /**
   * A field still holding the primitive its own initializer produced is left out of the blob: the
   * client's initializer produces it again, so restoring it is a no-op and the bytes buy nothing.
   *
   * What it is for, measured on `@ramonda/form` before the change: 942 of 1935 bytes of a
   * five-row page were hydration state, nearly all of it `{"version":0}` — the subscription
   * counter every watched component carries, always zero on the server. At 300 rows, around 17 KB
   * of markup saying nothing.
   */
  test("a field still holding its initial primitive is left out", async () => {
    class Widget extends Component {
      @state version = 0;
      @state touched = 0;
      @persist token = "abc";
      render() {
        return <div>x</div>;
      }
    }

    const app = await getDOM<Widget>(<Widget />);
    app.instance.touched = 1;
    await app.settle();

    // Only what MOVED. `version` and `token` are still what their initializers produced.
    expect(serializeComponentTree(app.instance).state).toEqual({ touched: 1 });
  });

  /**
   * The bound that decides the rule, and it is correctness rather than thrift.
   *
   * An in-place mutation keeps the very object the initializer produced, so an identity test on an
   * object would call a filled value untouched and hand the client an empty one.
   *
   * **A class instance rather than an array, and the reason is a DEV/production divergence worth
   * knowing.** `mutationGuard` wraps plain objects and arrays in a proxy, so in development
   * `this.rows` reads back as a proxy and never matches the raw array the initializer produced —
   * the identity test would fail to fire, the test would pass, and the fault would ship to
   * production where there is no proxy. A value with a prototype of its own is left alone by the
   * guard (its methods need the real receiver), so identity here is the same on both sides and the
   * planted fault is caught in the environment the tests run in.
   */
  test("an object is always serialized, even when it is the one the initializer produced", async () => {
    class Box {
      n = 0;
    }
    class Widget extends Component {
      @state box = new Box();
      render() {
        return <div>x</div>;
      }
    }

    const app = await getDOM<Widget>(<Widget />);
    app.instance.box.n = 1;
    await app.settle();

    expect(serializeComponentTree(app.instance).state).toEqual({ box: { n: 1 } });
  });

  /**
   * A field written back to its initial value is serialized, because the value MOVED and came back
   * — and the comparison is against what the initializer produced, not against "has anything been
   * written". Restoring it is a no-op either way, so this costs a few bytes and buys the rule being
   * one sentence: what the initializer produced, still there.
   */
  test("a value written back to its initial is still left out", async () => {
    class Widget extends Component {
      @state count = 0;
      render() {
        return <div>x</div>;
      }
    }

    const app = await getDOM<Widget>(<Widget />);
    app.instance.count = 5;
    await app.settle();
    app.instance.count = 0;
    await app.settle();

    expect(serializeComponentTree(app.instance).state).toEqual({});
  });

  /**
   * A field the server EMPTIED must not come back as its default.
   *
   * `JSON.stringify({ name: undefined })` is `{}`, so `undefined` cannot ride in `state` at all —
   * which made a field the server cleared indistinguishable from one it never touched. Measured
   * before the fix: `@state name = "Ada"` set to `undefined` serialized to `{"state":{}}`, and the
   * browser's own initializer put "Ada" back. A signed-out visitor got the signed-in name.
   *
   * So the emptied keys travel in their own list. `null` is not among them and must not be:
   * JSON carries `null` perfectly well, and folding the two together would make an explicit `null`
   * impossible to express.
   */
  test("a field emptied on the server travels as cleared, not as absent", async () => {
    class Widget extends Component {
      @state name: string | undefined = "Ada";
      @state note: string | null = "hi";
      render() {
        return <div>x</div>;
      }
    }

    const app = await getDOM<Widget>(<Widget />);
    app.instance.name = undefined;
    app.instance.note = null;
    await app.settle();

    const tree = serializeComponentTree(app.instance);
    expect(tree.cleared).toEqual(["name"]);
    expect(tree.state).toEqual({ note: null });
    // And it survives the JSON round trip, which is the whole reason the list exists.
    expect(JSON.parse(serializeComponentToJSON(app.instance))).toEqual({
      state: { note: null },
      cleared: ["name"],
    });
  });

  /**
   * The mirror case, and the reason `cleared` cannot simply list every `undefined`: a field whose
   * initializer produced `undefined` and still holds it has not been emptied by anyone. It is
   * skipped like any other untouched value, and the client's initializer produces `undefined`
   * again.
   */
  test("a field whose initializer produced undefined is not listed as cleared", async () => {
    class Widget extends Component {
      @state maybe: string | undefined = undefined;
      render() {
        return <div>x</div>;
      }
    }

    const app = await getDOM<Widget>(<Widget />);
    const tree = serializeComponentTree(app.instance);

    expect(tree.cleared).toBeUndefined();
    expect(tree.state).toEqual({});
  });

  test("empty component serializes to an empty state object", async () => {
    class Bare extends Component {
      render() {
        return <div>x</div>;
      }
    }

    const app = await getDOM<Bare>(<Bare />);
    const tree = serializeComponentTree(app.instance);

    expect(tree).toEqual({ state: {} });
  });
});
