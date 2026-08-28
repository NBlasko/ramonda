import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "../base/Component";
import { state, updated, mounted } from "../base/decorators";
import { ErrorBoundary } from "../base/ErrorBoundary";

/**
 * What an `ErrorBoundary` reaches, checked against what the docs say it reaches.
 *
 * The line worth drawing is not "render vs everything else" — it is **whether the
 * throw happens on a path the framework is running**. A render, an `@updated` and
 * an `@mounted` are all framework-driven: the error goes to `errorHandler`, which
 * walks up for a handler. A click is not: the browser calls the listener, so a
 * throw inside it never passes through the framework at all and no boundary can
 * see it. Same for a promise that rejects on its own time.
 *
 * The docs page said `@updated` and a subscription's `connect` were "reported, not
 * caught here". They are caught — `flushUpdated` and `flushPostCommit` both route
 * through `errorHandler` — and a page that thinks its boundary does not cover the
 * commit phase would write a try/catch it does not need, or worse, trust a
 * boundary it thinks is narrower than it is.
 */
describe("what an ErrorBoundary reaches", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  test("a throw in render is caught", async () => {
    class Boom extends Component {
      render(): never {
        throw new Error("render boom");
      }
    }

    const app = await getDOM(
      <ErrorBoundary fallback={({ message }) => <p>caught: {message}</p>}>
        <Boom />
      </ErrorBoundary>,
    );
    await app.settle();

    expect(app.container.textContent).toContain("caught: render boom");
  });

  test("a throw in @updated is caught too — it is the framework's own phase", async () => {
    class Boom extends Component<{ tick: number }> {
      @updated afterRender() {
        if (this.props.tick > 0) throw new Error("updated boom");
      }
      render() {
        return (
          <div>
            <p>{this.props.tick}</p>
          </div>
        );
      }
    }

    class App extends Component {
      @state tick = 0;
      render() {
        return (
          <div>
            <ErrorBoundary fallback={({ message }) => <p>caught: {message}</p>}>
              <Boom tick={this.tick} />
            </ErrorBoundary>
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();

    app.instance.tick = 1;
    await app.settle();

    expect(app.container.textContent).toContain("caught: updated boom");
  });

  test("a throw in @mounted is caught", async () => {
    class Boom extends Component {
      @mounted ready(): never {
        throw new Error("mount boom");
      }
      render() {
        return (
          <div>
            <p>x</p>
          </div>
        );
      }
    }

    const app = await getDOM(
      <ErrorBoundary fallback={({ message }) => <p>caught: {message}</p>}>
        <Boom />
      </ErrorBoundary>,
    );
    await app.settle();

    expect(app.container.textContent).toContain("caught: mount boom");
  });

  test("a throw in an event handler is NOT — the browser called it, not the framework", async () => {
    class Boom extends Component {
      onClick(): never {
        throw new Error("click boom");
      }
      render() {
        return (
          <button onclick={this.onClick}>
            <span>click me</span>
          </button>
        );
      }
    }

    class App extends Component {
      render() {
        return (
          <div>
            <ErrorBoundary fallback={() => <p>caught</p>}>
              <Boom />
            </ErrorBoundary>
          </div>
        );
      }
    }

    const app = await getDOM(<App />);
    await app.settle();

    const button = app.container.querySelector("button")!;

    /**
     * The throw escapes to the environment, which is the whole point — so the
     * environment has to be told it was expected, or the runner reports an
     * unhandled error and fails a passing test. Catching it HERE is also the
     * proof: this is the only place it can be caught.
     */
    const swallow = (event: Event) => event.preventDefault();
    window.addEventListener("error", swallow);
    button.dispatchEvent(new MouseEvent("click"));
    window.removeEventListener("error", swallow);

    await app.settle();

    expect(app.container.textContent).toContain("click me");
    expect(app.container.textContent).not.toContain("caught");
  });
});
