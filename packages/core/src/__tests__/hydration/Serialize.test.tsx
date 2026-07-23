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
    await app.settle();

    const tree = serializeComponentTree(app.instance);
    expect(tree.state).toEqual({ count: 5, token: "abc" });
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
    const tree = serializeComponentTree(app.instance);

    expect(tree.state).toEqual({ top: 3 });
    expect(tree.hooks).toHaveLength(1);
    expect(tree.hooks![0].state).toEqual({ mid: 2 });
    expect(tree.hooks![0].hooks).toHaveLength(1);
    expect(tree.hooks![0].hooks![0].state).toEqual({ deep: 1 });
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
    const tree = serializeComponentTree(app.instance);

    expect(tree.hooks?.map((h) => h.state)).toEqual([{ a: "a" }, { b: "b" }]);
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
    const parsed = JSON.parse(serializeComponentToJSON(app.instance));

    expect(parsed.state.ok).toBe(1);
    expect("handler" in parsed.state).toBe(false);
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
