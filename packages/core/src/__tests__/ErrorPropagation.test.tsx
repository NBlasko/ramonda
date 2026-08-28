import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM, findOne } from "../test/setup";
import { Component, state, ErrorBoundary, created, mounted } from "../index";

/**
 * `errorHandler` walks UP from the component that threw looking for a
 * `catchError`, and rethrows if there is none. The walk itself was the untested
 * branch — every existing test had the boundary as the direct parent.
 */
class Boom extends Component<{ when?: string }> {
  @created early() {
    if (this.props.when === "create") throw new Error("create-boom");
  }
  @mounted later() {
    if (this.props.when === "mount") throw new Error("mount-boom");
  }
  render() {
    if (this.props.when === "render" || !this.props.when) throw new Error("render-boom");
    return (
      <div>
        <span>ok</span>
      </div>
    );
  }
}

describe("error propagation", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  test("a boundary two levels up still catches", async () => {
    class Middle extends Component {
      render() {
        return (
          <div>
            <div>
              <Boom />
            </div>
          </div>
        );
      }
    }
    class App extends Component {
      render() {
        return (
          <div>
            <ErrorBoundary fallback={({ message }: any) => <p className="fb">caught: {message}</p>}>
              <Middle />
            </ErrorBoundary>
          </div>
        );
      }
    }
    const app = await getDOM<App>(<App />);
    await app.settle();
    expect(app.container.textContent).toBe("caught: render-boom");
  });

  test("with no boundary anywhere, the error is rethrown", async () => {
    class App extends Component {
      render() {
        return (
          <div>
            <div>
              <Boom />
            </div>
          </div>
        );
      }
    }
    // Loud on purpose: swallowing it would leave a hole in the page with no
    // hint of why.
    await expect(getDOM<App>(<App />)).rejects.toThrow("render-boom");
  });

  test("a throw in @created is caught", async () => {
    class App extends Component {
      render() {
        return (
          <div>
            <ErrorBoundary fallback={({ message }: any) => <p>caught: {message}</p>}>
              <Boom when="create" />
            </ErrorBoundary>
          </div>
        );
      }
    }
    const app = await getDOM<App>(<App />);
    await app.settle();
    expect(app.container.textContent).toBe("caught: create-boom");
  });

  test("a throw in @mounted is caught", async () => {
    class App extends Component {
      render() {
        return (
          <div>
            <ErrorBoundary fallback={({ message }: any) => <p>caught: {message}</p>}>
              <Boom when="mount" />
            </ErrorBoundary>
          </div>
        );
      }
    }
    const app = await getDOM<App>(<App />);
    await app.settle();
    expect(app.container.textContent).toBe("caught: mount-boom");
  });

  test("a throw on a LATER render is caught, not just the first", async () => {
    class Flaky extends Component {
      @state explode = false;
      render() {
        if (this.explode) throw new Error("late-boom");
        return (
          <div>
            <span>fine</span>
          </div>
        );
      }
    }
    class App extends Component {
      render() {
        return (
          <div>
            <ErrorBoundary fallback={({ message }: any) => <p>caught: {message}</p>}>
              <Flaky />
            </ErrorBoundary>
          </div>
        );
      }
    }
    const app = await getDOM<App>(<App />);
    await app.settle();
    expect(app.container.textContent).toBe("fine");

    const flaky = findOne<{ explode: boolean }>(app.container, "Flaky");
    flaky.explode = true;
    await app.settle();

    expect(app.container.textContent).toBe("caught: late-boom");
  });
});
