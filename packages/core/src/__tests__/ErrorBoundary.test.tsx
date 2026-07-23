import { describe, test, expect } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
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
});
