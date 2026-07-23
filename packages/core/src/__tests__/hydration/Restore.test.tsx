import { describe, test, expect } from "vitest";
import { getDOM } from "../../test/setup";
import { state, persist } from "../../base/decorators";
import { Component } from "../../base/Component";
import { Hook } from "../../base/Hook";
import { serializeComponentToJSON } from "../../hydration/serialize";
import { restoreComponentTree, restoreComponentFromJSON } from "../../hydration/restore";

describe("hydration: client restore", () => {
  test("restores @state and @persist onto an instance", async () => {
    class Widget extends Component {
      @state count = 0;
      @persist token = "";
      render() {
        return <div>{this.count}</div>;
      }
    }

    const app = await getDOM<Widget>(<Widget />);
    restoreComponentTree(app.instance, { state: { count: 9, token: "xyz" } });

    expect(app.instance.count).toBe(9);
    expect(app.instance.token).toBe("xyz");
  });

  test("restores nested hooks by position", async () => {
    class Inner extends Hook {
      @state deep = 0;
    }
    class Outer extends Hook {
      inner = this.use(Inner);
      @state mid = 0;
    }
    class Root extends Component {
      outer = this.use(Outer);
      @state top = 0;
      render() {
        return <div>x</div>;
      }
    }

    const app = await getDOM<Root>(<Root />);
    restoreComponentTree(app.instance, {
      state: { top: 3 },
      hooks: [{ state: { mid: 2 }, hooks: [{ state: { deep: 1 } }] }],
    });

    const inst = app.instance as unknown as {
      top: number;
      outer: { mid: number; inner: { deep: number } };
    };
    expect(inst.top).toBe(3);
    expect(inst.outer.mid).toBe(2);
    expect(inst.outer.inner.deep).toBe(1);
  });

  test("restored @state drives a re-render", async () => {
    class Widget extends Component {
      @state n = 0;
      render() {
        return <div id="w">{this.n}</div>;
      }
    }

    const app = await getDOM<Widget>(<Widget />);
    expect(app.container.querySelector("#w")?.textContent).toBe("0");

    restoreComponentTree(app.instance, { state: { n: 42 } });
    await app.settle();

    expect(app.container.querySelector("#w")?.textContent).toBe("42");
  });

  test("round-trips serialize → restore into a fresh instance", async () => {
    class Widget extends Component {
      @state a = 1;
      @persist b = "x";
      render() {
        return <div>x</div>;
      }
    }

    const source = await getDOM<Widget>(<Widget />);
    source.instance.a = 7;
    source.instance.b = "y";
    await source.settle();
    const json = serializeComponentToJSON(source.instance);

    const target = await getDOM<Widget>(<Widget />);
    restoreComponentFromJSON(target.instance, json);

    expect(target.instance.a).toBe(7);
    expect(target.instance.b).toBe("y");
  });

  test("ignores unknown keys and tolerates a hook-count mismatch", async () => {
    class H extends Hook {
      @state v = 0;
    }
    class Root extends Component {
      h = this.use(H);
      @state s = 0;
      render() {
        return <div>x</div>;
      }
    }

    const app = await getDOM<Root>(<Root />);

    // Blob has an unknown key and no hooks — must not throw or leak.
    expect(() =>
      restoreComponentTree(app.instance, {
        state: { s: 5, bogus: "nope" },
      }),
    ).not.toThrow();

    expect(app.instance.s).toBe(5);
    expect((app.instance as unknown as Record<string, unknown>).bogus).toBeUndefined();
  });
});
