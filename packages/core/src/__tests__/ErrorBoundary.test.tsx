import { describe, test, expect } from "vitest";
import { getDOM, findAll } from "../test/setup";
import { Component } from "../base/Component";
import { state, created, interval, destroyed as destroyedDecorator } from "../base/decorators";
import { list } from "../base/list";
import { ShouldUpdateOnPropsChange } from "../index";
import { ErrorBoundary } from "../base/ErrorBoundary";

describe("ErrorBoundary", () => {
  test("renders children when no error", async () => {
    class Child extends Component {
      render() {
        return <p>OK</p>;
      }
    }

    const { container } = await getDOM(
      <ErrorBoundary fallback={() => <p>Error</p>}>
        <Child />
      </ErrorBoundary>,
    );

    expect(container.textContent).toContain("OK");
    expect(container.textContent).not.toContain("Error");
  });

  test("shows fallback when child render throws", async () => {
    class BrokenChild extends Component {
      render(): never {
        throw new Error("render boom");
      }
    }

    const { container } = await getDOM(
      <ErrorBoundary fallback={({ message }) => <p>Caught: {message}</p>}>
        <BrokenChild />
      </ErrorBoundary>,
    );

    expect(container.textContent).toContain("Caught: render boom");
    expect(container.textContent).not.toContain("OK");
  });

  test("fallback receives the error object", async () => {
    let capturedErr: Error | undefined;

    class BrokenChild extends Component {
      render(): never {
        throw new Error("specific error");
      }
    }

    await getDOM(
      <ErrorBoundary
        fallback={({ err }) => {
          capturedErr = err;
          return <p>error</p>;
        }}
      >
        <BrokenChild />
      </ErrorBoundary>,
    );

    expect(capturedErr).toBeInstanceOf(Error);
    expect(capturedErr?.message).toBe("specific error");
  });

  test("reset clears error and re-renders children", async () => {
    // ErrorBoundary catches throws from a CHILD's render, not from its own
    // parent. The throw is driven by a module-level flag the child reads while
    // rendering, which is the only way to flip it between renders from outside.
    let shouldThrow = true;
    let capturedReset: (() => void) | undefined;

    class Child extends Component {
      render() {
        if (shouldThrow) throw new Error("boom");
        return <p>recovered</p>;
      }
    }

    class App extends Component {
      render() {
        return (
          <ErrorBoundary
            fallback={({ reset }) => {
              capturedReset = reset;
              return <button>reset</button>;
            }}
          >
            <Child />
          </ErrorBoundary>
        );
      }
    }

    const { container, settle } = await getDOM(<App />);

    expect(container.querySelector("button")?.textContent).toBe("reset");

    // Fix the condition, then reset.
    shouldThrow = false;
    capturedReset!();
    await settle();

    expect(container.textContent).toContain("recovered");
    expect(container.querySelector("button")).toBeNull();
  });

  test("a child that throws in its OWN re-render reaches the boundary", async () => {
    /**
     * A component re-rendering itself is not reached through its parent, so nothing above it is
     * inside a build that could catch the throw — this is the path with no parent on the stack.
     */
    const destroyed: string[] = [];

    class Child extends Component {
      @state broken = false;
      @destroyedDecorator gone() {
        destroyed.push("Child");
      }
      render() {
        if (this.broken) throw new Error("boom in my own render");
        return <p id="child">child</p>;
      }
    }

    class App extends Component {
      render() {
        return (
          <div id="shell">
            <ErrorBoundary fallback={() => <p id="fallback">fallback</p>}>
              <Child />
            </ErrorBoundary>
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    const child = findAll<Child>(app.container, "Child")[0]!;

    child.broken = true;
    await app.settle();

    expect(app.container.querySelector("#fallback")).not.toBeNull();
    expect(app.container.querySelector("#child")).toBeNull();
    expect(destroyed).toEqual(["Child"]);
  });

  test("a props gate that throws reaches the boundary, and its component leaves", async () => {
    /**
     * `@ShouldUpdateOnPropsChange` is user code the diff calls SYNCHRONOUSLY, while the parent is
     * still reconciling — so it is one of the very few things that can throw with a LIVE region in
     * hand. The region has already been taken out of the map the loop's own teardown pass walks, so
     * nothing downstream would ever find it: without the by-hand teardown its nodes stay on the page
     * under the fallback and its `@destroyed` never runs.
     *
     * Found by removing that teardown and watching all 1295 tests pass — the branch was reachable
     * and nothing was asking it anything.
     */
    const torn: string[] = [];
    let gateThrows = false;

    @ShouldUpdateOnPropsChange(() => {
      if (gateThrows) throw new Error("gate boom");
      return true;
    })
    class Gated extends Component<{ n: number }> {
      @destroyedDecorator bye() {
        torn.push("gated");
      }
      render() {
        return <b id="gated">gated {String(this.props.n)}</b>;
      }
    }

    class Shell extends Component {
      @state n = 1;
      render() {
        return (
          <div id="shell">
            <ErrorBoundary fallback={() => <i id="fb">fb</i>}>
              <Gated n={this.n} />
            </ErrorBoundary>
            <u id="tail">tail</u>
          </div>
        );
      }
    }

    const app = await getDOM<Shell>(<Shell />);
    expect(app.container.querySelector("#gated")!.textContent).toBe("gated 1");

    gateThrows = true;
    app.instance.n = 2;
    await app.settle();

    expect(app.container.querySelector("#fb")).not.toBeNull();
    expect(app.container.querySelector("#gated")).toBeNull();
    expect(app.container.querySelector("#tail")).not.toBeNull();
    expect(torn).toEqual(["gated"]);
  });

  test("a replacement that fails to build leaves the one it replaced torn down exactly once", async () => {
    /**
     * A DIFFERENT class in the same slot: the one that was there is disposed by hand, because it has
     * already been taken out of the map the loop's own teardown pass walks. Then the replacement's
     * build throws — so the same region is reached a second time, by the catch around the child.
     *
     * Both halves are worth pinning. The old component must be gone (its `@destroyed` run, its nodes
     * out) rather than left standing invisibly under a fallback; and it must be torn down ONCE, or a
     * `@destroyed` that releases a lock or closes a connection would do it twice.
     */
    const torn: string[] = [];

    class Alpha extends Component {
      @destroyedDecorator bye() {
        torn.push("alpha");
      }
      render() {
        return <b id="alpha">alpha</b>;
      }
    }

    class Beta extends Component {
      render(): never {
        throw new Error("beta cannot build");
      }
    }

    class Shell extends Component {
      @state beta = false;
      render() {
        return (
          <div id="shell">
            <ErrorBoundary fallback={() => <i id="fb">fb</i>}>{this.beta ? <Beta /> : <Alpha />}</ErrorBoundary>
            <u id="tail">tail</u>
          </div>
        );
      }
    }

    const app = await getDOM<Shell>(<Shell />);
    expect(app.container.querySelector("#alpha")).not.toBeNull();

    app.instance.beta = true;
    await app.settle();

    expect(app.container.querySelector("#alpha")).toBeNull();
    expect(app.container.querySelector("#fb")).not.toBeNull();
    // The sibling after the boundary is untouched, and alpha left exactly once.
    expect(app.container.querySelector("#tail")).not.toBeNull();
    expect(torn).toEqual(["alpha"]);
  });

  test("a sibling built BEFORE the throw is torn down, not left ticking", async () => {
    /**
     * The throw comes from the list's mapper, after the component in front of it has already been
     * built. That component is only in the entries of the pass that threw, and a pass that throws
     * never returns them — so no record points at it, and `disposeRegions` walks records.
     *
     * Measured before the fix: `@created` had run, its `@interval` fired 8 times while the page
     * showed the fallback, `@destroyed` never ran, and it went on ticking after the whole root was
     * unmounted. A leak for the life of the page.
     */
    const events: string[] = [];
    let ticks = 0;

    class Early extends Component {
      @created({ env: "shared" }) hi() {
        events.push("created");
      }
      @destroyedDecorator bye() {
        events.push("destroyed");
      }
      @interval(5) beat() {
        ticks++;
      }
      render() {
        return <b id="early">early</b>;
      }
    }

    class Broken extends Component {
      render() {
        return [
          <Early />,
          list([1, 2], () => {
            throw new Error("mapper boom");
          }),
        ];
      }
    }

    class App extends Component {
      render() {
        return (
          <ErrorBoundary fallback={() => <i id="fb">fallback</i>}>
            <Broken />
          </ErrorBoundary>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    expect(app.container.querySelector("#fb")).not.toBeNull();
    expect(app.container.querySelector("#early")).toBeNull();
    expect(events).toEqual(["created", "destroyed"]);

    // And nothing it armed is still running: an interval this component started must be out.
    ticks = 0;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(ticks).toBe(0);
  });

  test("a sibling built inside a LIST before the throw is torn down too", async () => {
    /**
     * The same fault as the test above, one level of nesting down — and the undo list did not reach
     * it. A list recurses into a fresh `reconcileEntries`, whose own record of what it built is a
     * local that is discarded when it returns; so a throw LATER in this level tore nothing down.
     *
     * Measured before the fix: `@created` had run, the `@interval` went on firing under the
     * fallback, and `@destroyed` never ran — for a component no record points at.
     */
    const events: string[] = [];
    let ticks = 0;

    class Early extends Component {
      @created({ env: "shared" }) hi() {
        events.push("created");
      }
      @destroyedDecorator bye() {
        events.push("destroyed");
      }
      @interval(5) beat() {
        ticks++;
      }
      render() {
        return <b id="early">early</b>;
      }
    }

    class Broken extends Component {
      render() {
        return [
          list([1], () => <Early />),
          list([2], () => {
            throw new Error("mapper boom");
          }),
        ];
      }
    }

    class App extends Component {
      render() {
        return (
          <ErrorBoundary fallback={() => <i id="fb">fallback</i>}>
            <Broken />
          </ErrorBoundary>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    expect(app.container.querySelector("#fb")).not.toBeNull();
    expect(app.container.querySelector("#early")).toBeNull();
    expect(events).toEqual(["created", "destroyed"]);

    ticks = 0;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(ticks).toBe(0);
  });

  test("a child that throws on a LATER render is torn down, not left behind", async () => {
    /**
     * The first render worked, so there is a live region — an instance with state, hooks and a
     * lifecycle, and a run of nodes in the parent. The throw drops the child from this render, and
     * that region is nobody else's to find: it has already been taken out of the index the teardown
     * pass walks, so it has to be disposed by hand right there.
     *
     * Left undone, the nodes stay in the page under the fallback and `@destroyed` never runs.
     */
    let shouldThrow = false;
    const destroyed: string[] = [];

    class Child extends Component<{ tick: number }> {
      @destroyedDecorator gone() {
        destroyed.push("Child");
      }
      render() {
        if (shouldThrow) throw new Error("boom on the second pass");
        return <p id="child">child {this.props.tick}</p>;
      }
    }

    class App extends Component {
      @state tick = 0;
      render() {
        return (
          <div id="shell" data-tick={String(this.tick)}>
            <ErrorBoundary fallback={() => <p id="fallback">fallback</p>}>
              <Child tick={this.tick} />
            </ErrorBoundary>
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    expect(app.container.querySelector("#child")).not.toBeNull();

    shouldThrow = true;
    app.instance.tick++;
    await app.settle();

    expect(app.container.querySelector("#fallback")).not.toBeNull();
    expect(app.container.querySelector("#child")).toBeNull();
    // The instance really went: its region was disposed rather than dropped on the floor.
    expect(destroyed).toEqual(["Child"]);
  });
});
