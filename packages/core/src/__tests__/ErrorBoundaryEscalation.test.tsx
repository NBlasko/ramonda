import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { ErrorBoundary } from "../base/ErrorBoundary";
import { state } from "../base/decorators";

/**
 * What happens when the FALLBACK is the thing that throws.
 *
 * The error walk starts at the component that failed and takes the first
 * ancestor with a `catchError`. A fallback renders inside its own boundary, so
 * the first ancestor is that boundary — the one already showing a fallback. It
 * set `hasError = true`, which it already was, so nothing changed, nothing
 * re-rendered, and the walk stopped there and reported the error handled. The
 * page was left on the DOM from before the throw and the outer boundary, whose
 * whole job is this, never heard about it.
 *
 * A boundary that is already displaying its fallback therefore declines the next
 * error and lets it travel, which is the only answer that keeps "an unhandled
 * error reaches the top" true.
 *
 * The last two tests are the other half: declining must not become "stops
 * catching". A healthy boundary still catches, and one that has been `reset` is
 * healthy again.
 */
describe("an error thrown while a boundary shows its fallback", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  test("escalates to the boundary above instead of being swallowed", async () => {
    class BrokenChild extends Component {
      render(): never {
        throw new Error("child boom");
      }
    }

    const app = await getDOM(
      <ErrorBoundary fallback={({ message }) => <p>outer caught: {message}</p>}>
        <ErrorBoundary
          fallback={(): never => {
            throw new Error("fallback boom");
          }}
        >
          <BrokenChild />
        </ErrorBoundary>
      </ErrorBoundary>,
    );
    await app.settle();

    expect(app.container.textContent).toContain("outer caught: fallback boom");
  });

  test("the inner boundary still catches while it is healthy", async () => {
    class BrokenChild extends Component {
      render(): never {
        throw new Error("child boom");
      }
    }

    const app = await getDOM(
      <ErrorBoundary fallback={() => <p>outer</p>}>
        <ErrorBoundary fallback={({ message }) => <p>inner caught: {message}</p>}>
          <BrokenChild />
        </ErrorBoundary>
      </ErrorBoundary>,
    );
    await app.settle();

    expect(app.container.textContent).toContain("inner caught: child boom");
    expect(app.container.textContent).not.toContain("outer");
  });

  test("a boundary that has been reset catches again", async () => {
    // Module-scoped rather than component state, because the component under
    // test is the one that throws: it has no instance to reach into once its
    // render has failed.
    let broken = true;
    let resetBoundary: (() => void) | undefined;

    class Flaky extends Component<{ tick: number }> {
      render() {
        if (broken) throw new Error("boom");
        return <p>recovered {this.props.tick}</p>;
      }
    }

    class App extends Component {
      @state tick = 0;

      render() {
        return (
          <ErrorBoundary
            fallback={({ message, reset }) => {
              resetBoundary = reset;
              return <p>caught: {message}</p>;
            }}
          >
            <Flaky tick={this.tick} />
          </ErrorBoundary>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();
    expect(app.container.textContent).toContain("caught: boom");

    broken = false;
    resetBoundary!();
    await app.settle();
    expect(app.container.textContent).toContain("recovered");

    // Healthy again, so the next error is its to catch — not the parent's.
    broken = true;
    app.instance.tick++;
    await app.settle();
    expect(app.container.textContent).toContain("caught: boom");
  });
});
