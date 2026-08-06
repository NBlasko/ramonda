import { describe, test, expect } from "vitest";
import { getDOM } from "../test/setup";
import { state, persist } from "../base/decorators";
import { Component } from "../base/Component";
import { Hook } from "../base/Hook";
import { createContext } from "../base/Context";
import { scanComponentTree } from "../debug/inspector";
import { inspectTree, setInspectRoot } from "../debug/devtoolsBridge";

describe("inspector: component + hook state", () => {
  test("reads @state and @persist off a component", async () => {
    class Widget extends Component {
      @state count = 0;
      @persist token = "abc";
      render() {
        return <div>{this.count}</div>;
      }
    }

    const app = await getDOM<Widget>(<Widget />);
    app.instance.count = 7;
    await app.settle();

    const tree = scanComponentTree(app.container);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("Widget");
    expect(tree[0].kind).toBe("component");
    expect(tree[0].state).toEqual({ count: 7, token: "abc" });
    expect(tree[0].node).toBeTruthy();
  });

  test("includes hooks and nested hooks with their state", async () => {
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
    const node = scanComponentTree(app.container)[0];

    expect(node.state).toEqual({ top: 3 });
    expect(node.hooks).toHaveLength(1);
    expect(node.hooks[0].name).toBe("Outer");
    expect(node.hooks[0].kind).toBe("hook");
    expect(node.hooks[0].state).toEqual({ mid: 2 });
    expect(node.hooks[0].hooks[0].name).toBe("Inner");
    expect(node.hooks[0].hooks[0].state).toEqual({ deep: 1 });
  });

  /**
   * Two of one hook in one component are two nodes with one name, because a hook cannot name itself —
   * `this.constructor.name` is the class, shared by every instance. `label` is the only place the
   * distinguishing name can come from: it arrives per `use()`, which is where the difference exists.
   */
  test("names a hook by its `label` option when it has one", async () => {
    class Store extends Hook<{ label?: string; seed: number }> {
      @state value = this.props.seed;
    }
    class Page extends Component {
      signup = this.use(Store, { label: "signup", seed: 1 });
      login = this.use(Store, { label: "login", seed: 2 });
      plain = this.use(Store, { seed: 3 });
      render() {
        return <div>x</div>;
      }
    }

    const app = await getDOM<Page>(<Page />);
    const node = scanComponentTree(app.container)[0];

    // The class AND the label, because each answers a different question: `Store` says what the node
    // is, `signup` says which one. A hook given no label reads exactly as it did before.
    expect(node.hooks.map((hook) => hook.name)).toEqual(["Store (signup)", "Store (login)", "Store"]);
    // The label is still visible as what it is, an option, so nothing is hidden by being used.
    expect(node.hooks[0].options).toMatchObject({ label: "signup", seed: 1 });
  });

  test("ignores a label that is not a name, or that only repeats the class", async () => {
    class Store extends Hook<{ label?: unknown }> {
      @state value = 1;
    }
    class Page extends Component {
      blank = this.use(Store, { label: "   " });
      wrong = this.use(Store, { label: 42 });
      same = this.use(Store, { label: "Store" });
      render() {
        return <div>x</div>;
      }
    }

    const app = await getDOM<Page>(<Page />);
    const node = scanComponentTree(app.container)[0];

    // A hook with other plans for the word keeps them: only a non-empty string is taken. And a label
    // that repeats the class earns nothing but a pair of brackets, so it is dropped.
    expect(node.hooks.map((hook) => hook.name)).toEqual(["Store", "Store", "Store"]);
  });

  test("exposes a component's props (minus children/key)", async () => {
    class Child extends Component<{ label: string; count: number }> {
      render() {
        return <span>{this.props.label}</span>;
      }
    }
    class App extends Component {
      render() {
        return <Child label="hi" count={3} />;
      }
    }

    const app = await getDOM<App>(<App />);
    const child = scanComponentTree(app.container)[0].children[0];

    expect(child.name).toBe("Child");
    expect(child.props).toEqual({ label: "hi", count: 3 });
  });

  test("exposes a hook's options (e.g. a context provider's value)", async () => {
    const [Provider, Ctx] = createContext({ theme: "light" });

    class Consumer extends Component {
      ctx = this.use(Ctx);
      render() {
        return <span>{this.ctx.theme}</span>;
      }
    }
    class App extends Component {
      @state theme = "dark";
      provider = this.use(Provider, () => ({ theme: this.theme }));
      render() {
        return <Consumer />;
      }
    }

    const app = await getDOM<App>(<App />);
    const node = scanComponentTree(app.container)[0];

    // The provider hook is empty on @state but its provided value shows as options.
    const providerNode = node.hooks.find((h) => h.name === "Provider");
    expect(providerNode?.options).toEqual({ theme: "dark" });
  });

  test("labels a context's hooks for devtools", async () => {
    const [Provider, Ctx] = createContext({ theme: "light" }, { label: "Theme" });

    class Reader extends Component {
      ctx = this.use(Ctx);
      render() {
        return <span>{this.ctx.theme}</span>;
      }
    }
    class App extends Component {
      provider = this.use(Provider, () => ({ theme: "dark" }));
      render() {
        return <Reader />;
      }
    }

    const app = await getDOM<App>(<App />);
    const node = scanComponentTree(app.container)[0];

    expect(node.hooks[0].name).toBe("ThemeProvider");
    expect(node.children[0].hooks[0].name).toBe("ThemeConsumer");
  });

  test("falls back to Provider/Consumer without a label", async () => {
    const [Provider] = createContext({ theme: "light" });

    class App extends Component {
      provider = this.use(Provider, () => ({ theme: "dark" }));
      render() {
        return <span>x</span>;
      }
    }

    const app = await getDOM<App>(<App />);
    expect(scanComponentTree(app.container)[0].hooks[0].name).toBe("Provider");
  });

  test("live-reads current values (reflects updates)", async () => {
    class Counter extends Component {
      @state n = 0;
      render() {
        return <div>{this.n}</div>;
      }
    }

    const app = await getDOM<Counter>(<Counter />);
    setInspectRoot(app.container);

    expect(inspectTree()[0].state.n).toBe(0);

    app.instance.n = 42;
    await app.settle();

    // Same pull function, new value — no push/serialization involved.
    expect(inspectTree()[0].state.n).toBe(42);
  });

  test("nests child components in the tree", async () => {
    class Leaf extends Component {
      @state v = "leaf";
      render() {
        return <span>{this.v}</span>;
      }
    }
    class Parent extends Component {
      render() {
        return (
          <div>
            <Leaf />
          </div>
        );
      }
    }

    const app = await getDOM<Parent>(<Parent />);
    const node = scanComponentTree(app.container)[0];

    expect(node.name).toBe("Parent");
    expect(node.children).toHaveLength(1);
    expect(node.children[0].name).toBe("Leaf");
    expect(node.children[0].state).toEqual({ v: "leaf" });
  });
});
