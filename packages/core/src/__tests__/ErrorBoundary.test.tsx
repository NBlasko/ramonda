import { describe, test, expect } from "vitest";
import { getDOM, findAll } from "../test/setup";
import { Component } from "../base/Component";
import { state, destroyed as destroyedDecorator } from "../base/decorators";
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
