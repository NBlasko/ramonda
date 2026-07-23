import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, state, ErrorBoundary, create, mount } from "../index";

/**
 * `errorHandler` walks UP from the component that threw looking for a
 * `catchError`, and rethrows if there is none. The walk itself was the untested
 * branch — every existing test had the boundary as the direct parent.
 */
@Host("div")
class Boom extends Component<{ when?: string }> {
  @create early() {
    if (this.props.when === "create") throw new Error("create-boom");
  }
  @mount later() {
    if (this.props.when === "mount") throw new Error("mount-boom");
  }
  render() {
    if (this.props.when === "render" || !this.props.when) throw new Error("render-boom");
    return <span>ok</span>;
  }
}

describe("error propagation", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  test("a boundary two levels up still catches", async () => {
    @Host("div")
    class Middle extends Component {
      render() {
        return (
          <div>
            <Boom />
          </div>
        );
      }
    }
    @Host("div")
    class App extends Component {
      render() {
        return (
          <ErrorBoundary fallback={({ message }: any) => <p className="fb">caught: {message}</p>}>
            <Middle />
          </ErrorBoundary>
        );
      }
    }
    const app = await getDOM<App>(<App />);
    await app.settle();
    expect(app.container.textContent).toBe("caught: render-boom");
  });

  test("with no boundary anywhere, the error is rethrown", async () => {
    @Host("div")
    class App extends Component {
      render() {
        return (
          <div>
            <Boom />
          </div>
        );
      }
    }
    // Loud on purpose: swallowing it would leave a hole in the page with no
    // hint of why.
    await expect(getDOM<App>(<App />)).rejects.toThrow("render-boom");
  });

  test("a throw in @create is caught", async () => {
    @Host("div")
    class App extends Component {
      render() {
        return (
          <ErrorBoundary fallback={({ message }: any) => <p>caught: {message}</p>}>
            <Boom when="create" />
          </ErrorBoundary>
        );
      }
    }
    const app = await getDOM<App>(<App />);
    await app.settle();
    expect(app.container.textContent).toBe("caught: create-boom");
  });

  test("a throw in @mount is caught", async () => {
    @Host("div")
    class App extends Component {
      render() {
        return (
          <ErrorBoundary fallback={({ message }: any) => <p>caught: {message}</p>}>
            <Boom when="mount" />
          </ErrorBoundary>
        );
      }
    }
    const app = await getDOM<App>(<App />);
    await app.settle();
    expect(app.container.textContent).toBe("caught: mount-boom");
  });

  test("a throw on a LATER render is caught, not just the first", async () => {
    @Host("div")
    class Flaky extends Component {
      @state explode = false;
      render() {
        if (this.explode) throw new Error("late-boom");
        return <span>fine</span>;
      }
    }
    @Host("div")
    class App extends Component {
      render() {
        return (
          <ErrorBoundary fallback={({ message }: any) => <p>caught: {message}</p>}>
            <Flaky />
          </ErrorBoundary>
        );
      }
    }
    const app = await getDOM<App>(<App />);
    await app.settle();
    expect(app.container.textContent).toBe("fine");

    const flaky = (
      app.container.querySelector('[data-ramonda="Flaky"]') as unknown as {
        _componentInstance: { explode: boolean };
      }
    )._componentInstance;
    flaky.explode = true;
    await app.settle();

    expect(app.container.textContent).toBe("caught: late-boom");
  });
});
