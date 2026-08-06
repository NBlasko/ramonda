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

/**
 * The metadata a `use()` carries is a symbol property written onto the hook instance IN DEVELOPMENT
 * ONLY. State is restored by POSITION over the hook list, so anything that made a labelled hook
 * enumerate, serialize or count differently from an unlabelled one would be a hydration mismatch that
 * exists in development and not in production — the hardest kind to be told about.
 *
 * The property is non-enumerable and keyed by a symbol, which is what makes that safe. This asserts it
 * across the two walks that decide hydration rather than trusting the descriptor.
 */
describe("hydration: a hook labelled in its use() metadata", () => {
  test("serializes and restores exactly as an unlabelled one", async () => {
    class Store extends Hook<{ seed: number }> {
      @state value = this.props.seed;
    }
    class Page extends Component {
      named = this.use(Store, { seed: 1 }, { label: "signup" });
      plain = this.use(Store, { seed: 2 });
      @state top = 0;
      render() {
        return <div>x</div>;
      }
    }

    const app = await getDOM<Page>(<Page />);

    // The SERVER's half: the blob a labelled hook produces is the shape the client expects, and the
    // label is nowhere in it — it is a development label, not application state.
    const blob = serializeComponentToJSON(app.instance);
    expect(JSON.parse(blob)).toEqual({
      state: { top: 0 },
      hooks: [{ state: { value: 1 } }, { state: { value: 2 } }],
    });
    expect(blob).not.toContain("signup");

    // The CLIENT's half: two hooks, in order, both restored — a count that differed by one would
    // land the second hook's state on the first or nowhere.
    restoreComponentTree(app.instance, {
      state: { top: 7 },
      hooks: [{ state: { value: 11 } }, { state: { value: 22 } }],
    });

    expect(app.instance.top).toBe(7);
    expect(app.instance.named.value).toBe(11);
    expect(app.instance.plain.value).toBe(22);
  });

  test("is invisible to an enumeration of the instance", async () => {
    class Store extends Hook {
      @state value = 1;
    }
    class Page extends Component {
      named = this.use(Store, undefined, { label: "signup" });
      render() {
        return <div>x</div>;
      }
    }

    const app = await getDOM<Page>(<Page />);
    const hook = app.instance.named;

    // The three walks anything in this repository does over an instance.
    expect(Object.keys(hook)).not.toContain("label");
    expect(JSON.stringify(hook)).not.toContain("signup");
    expect(Object.entries(hook).map(([key]) => key)).not.toContain("label");
    // Present all the same, which is how the panel reads it.
    expect((hook as never as Record<symbol, unknown>)[Symbol.for("ramonda.hook.meta")]).toEqual({
      label: "signup",
    });
  });
});
