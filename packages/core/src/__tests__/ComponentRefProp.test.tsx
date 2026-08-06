import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, state, createRef } from "../index";
import { scanComponentTree } from "../debug/inspector";

/**
 * A component's `ref` is the framework's, not the app's data.
 *
 * `<Child ref={r} />` points `r` at the child's host element when the child is
 * CREATED, and is never read again. Its identity therefore says nothing about
 * whether the child should re-render — but it lived in the props bag and was
 * compared like any other prop, so an inline `ref={createRef()}` handed the child
 * a new object on every parent render and re-rendered it every time, forever,
 * with no diagnostic.
 *
 * `key` is left in the comparison on purpose, and the reason is worth keeping:
 * `areSimilarNodes` refuses a node whose key differs, so a component that reaches
 * the update path always has an equal key. Ignoring it would remove nothing.
 */
describe("a component's ref prop", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("still points at the host element", async () => {
    class Child extends Component<{ a: number }> {
      render() {
        return <p>{this.props.a}</p>;
      }
    }

    const ref = createRef<HTMLElement>();

    @Host("div")
    class App extends Component {
      render() {
        return <Child a={1} ref={ref} />;
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    expect(ref.current).toBe(app.container.querySelector("ramonda-host"));
  });

  test("an inline ref no longer re-renders the child on every parent render", async () => {
    let childRenders = 0;

    class Child extends Component<{ a: number }> {
      render() {
        childRenders++;
        return <p>{this.props.a}</p>;
      }
    }

    @Host("div")
    class App extends Component {
      @state tick = 0;

      render() {
        // A fresh Ref object every render — the pattern that used to cost a
        // child render per parent render.
        return (
          <div data-tick={String(this.tick)}>
            <Child a={1} ref={createRef<HTMLElement>()} />
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    childRenders = 0;
    app.instance.tick++;
    await app.settle();
    app.instance.tick++;
    await app.settle();

    expect(childRenders).toBe(0);
    // By attribute, not by tag: @Host("div") means the first <div> is the host.
    expect(app.container.querySelector("[data-tick]")!.getAttribute("data-tick")).toBe("2");
  });

  test("a real prop change still re-renders the child", async () => {
    let childRenders = 0;

    class Child extends Component<{ a: number }> {
      render() {
        childRenders++;
        return <p>{this.props.a}</p>;
      }
    }

    @Host("div")
    class App extends Component {
      @state a = 1;

      render() {
        return <Child a={this.a} ref={createRef<HTMLElement>()} />;
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    childRenders = 0;
    app.instance.a = 2;
    await app.settle();

    expect(childRenders).toBe(1);
    expect(app.container.textContent).toContain("2");
  });

  test("a prop appearing or disappearing alongside a ref is still noticed", async () => {
    let seen: unknown;

    class Child extends Component<{ a: number; b?: number }> {
      render() {
        seen = this.props.b;
        return <p>{this.props.a}</p>;
      }
    }

    @Host("div")
    class App extends Component {
      @state withB = false;
      ref = createRef<HTMLElement>();

      render() {
        // The count of keys differs by one on each side, and one of those keys
        // is the ignored `ref` — the case a naive length check gets wrong.
        return this.withB ? <Child a={1} b={2} ref={this.ref} /> : <Child a={1} ref={this.ref} />;
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();
    expect(seen).toBe(undefined);

    app.instance.withB = true;
    await app.settle();
    expect(seen).toBe(2);

    app.instance.withB = false;
    await app.settle();
    expect(seen).toBe(undefined);
  });

  /**
   * The same arrangements an ELEMENT already handled, on a component.
   *
   * On an element a swapped ref works because `Attribute.ts` releases the one it
   * replaces and points the new one at the node, on every render. A component's
   * ref was applied from `createComponent` alone, so a component that stayed put
   * while its ref changed kept the old one: the new ref never filled, and the old
   * one went on pointing at a host that no longer claimed it. Silent both ways,
   * and the opposite of what the identical JSX does one line down on a `<p>`.
   */
  describe("moving a ref while the component stays", () => {
    test("the new ref fills and the old one is released", async () => {
      const r1 = createRef<HTMLElement>();
      const r2 = createRef<HTMLElement>();

      @Host("p")
      class Child extends Component {
        render() {
          return <i />;
        }
      }

      @Host("div")
      class App extends Component {
        @state useFirst = true;

        render() {
          return <Child ref={this.useFirst ? r1 : r2} />;
        }
      }

      const app = await getDOM<App>(<App />);
      await app.settle();

      const host = app.container.querySelector("p");
      expect(r1.current).toBe(host);
      expect(r2.current).toBe(null);

      app.instance.useFirst = false;
      await app.settle();

      expect(r2.current).toBe(host);
      expect(r1.current).toBe(null);
    });

    test("a ref removed from the JSX is released", async () => {
      const ref = createRef<HTMLElement>();

      @Host("p")
      class Child extends Component {
        render() {
          return <i />;
        }
      }

      @Host("div")
      class App extends Component {
        @state keep = true;

        render() {
          return <Child ref={this.keep ? ref : undefined} />;
        }
      }

      const app = await getDOM<App>(<App />);
      await app.settle();
      expect(ref.current).toBe(app.container.querySelector("p"));

      app.instance.keep = false;
      await app.settle();

      expect(ref.current).toBe(null);
    });

    test("a ref added later still finds the host", async () => {
      const ref = createRef<HTMLElement>();

      @Host("p")
      class Child extends Component {
        render() {
          return <i />;
        }
      }

      @Host("div")
      class App extends Component {
        @state attach = false;

        render() {
          return <Child ref={this.attach ? ref : undefined} />;
        }
      }

      const app = await getDOM<App>(<App />);
      await app.settle();
      expect(ref.current).toBe(null);

      app.instance.attach = true;
      await app.settle();

      expect(ref.current).toBe(app.container.querySelector("p"));
    });

    test("swapping a ref does not re-render the child", async () => {
      let childRenders = 0;
      const r1 = createRef<HTMLElement>();
      const r2 = createRef<HTMLElement>();

      @Host("p")
      class Child extends Component {
        render() {
          childRenders++;
          return <i />;
        }
      }

      @Host("div")
      class App extends Component {
        @state useFirst = true;

        render() {
          return <Child ref={this.useFirst ? r1 : r2} />;
        }
      }

      const app = await getDOM<App>(<App />);
      await app.settle();

      childRenders = 0;
      app.instance.useFirst = false;
      await app.settle();

      // A ref is not a render input: pointing it somewhere else changes nothing
      // the child renders.
      expect(childRenders).toBe(0);
      expect(r2.current).toBe(app.container.querySelector("p"));
    });
  });

  test("the inspector does not show ref among a component's props", async () => {
    class Child extends Component<{ label: string }> {
      render() {
        return <span>{this.props.label}</span>;
      }
    }

    const ref = createRef<HTMLElement>();

    @Host("div")
    class App extends Component {
      render() {
        return <Child label="hi" ref={ref} />;
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    const child = scanComponentTree(app.container)[0].children[0];
    expect(child.props).toEqual({ label: "hi" });
  });
});
