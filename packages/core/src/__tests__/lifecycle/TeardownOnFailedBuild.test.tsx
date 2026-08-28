import { describe, test, expect, vi, afterEach } from "vitest";
import { getDOM, instanceOf } from "../../test/setup";
import { Component, created, destroyed, ErrorBoundary } from "../../index";
import { lifecycleCleanupManagement } from "../../helpers/lifecycleMenagement";

/**
 * A component whose BUILD fails is still torn down.
 *
 * It was not. Teardown is reached from `unmountChildrenNodes`, which walks the
 * DOM — and a component that threw in `@created` or `render()` never had its host
 * inserted anywhere, so nothing could reach it. `errorHandler` is handed the
 * PLACEHOLDER (the parent), not the component that failed, so the failed instance
 * was simply abandoned.
 *
 * Measured before the fix, with `@created` acquiring something:
 *
 *   render() throws after @created   ->  log: create           (no destroy)
 *   @created itself throws           ->  log: create           (no destroy)
 *   @mounted throws, removed normally ->  log: create,mount,destroy   (already fine)
 *
 * The narrow-but-real cost: `@interval` / `@timeout` / `@onWindow` do NOT leak,
 * because they are built on effects and effects run after the commit — a build
 * that throws never reaches them. What leaks is anything taken by hand in
 * `@created`: a subscription, a raw listener, an open connection, an
 * AbortController nobody aborts.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("teardown when the build fails", () => {
  test("render() throwing after @created still runs @destroyed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const log: string[] = [];

    class Broken extends Component {
      @created born() {
        log.push("create"); // stands in for acquiring a resource
      }
      @destroyed gone() {
        log.push("destroy");
      }
      render(): never {
        throw new Error("render boom");
      }
    }

    class App extends Component {
      render() {
        return (
          <div>
            <ErrorBoundary fallback={() => <p>err</p>}>
              <Broken />
            </ErrorBoundary>
          </div>
        );
      }
    }

    await getDOM(<App />);
    await settle();

    expect(log).toEqual(["create", "destroy"]);
  });

  test("@created throwing still runs @destroyed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const log: string[] = [];

    class Broken extends Component {
      @created born() {
        log.push("create");
        throw new Error("create boom");
      }
      @destroyed gone() {
        log.push("destroy");
      }
      render() {
        return (
          <div>
            <span>x</span>
          </div>
        );
      }
    }

    class App extends Component {
      render() {
        return (
          <div>
            <ErrorBoundary fallback={() => <p>err</p>}>
              <Broken />
            </ErrorBoundary>
          </div>
        );
      }
    }

    await getDOM(<App />);
    await settle();

    // @destroyed runs over a half-initialised component on purpose: leaking less
    // was preferred to the more predictable "never finished mounting, so no
    // cleanup" rule. @destroyed has to tolerate it.
    expect(log).toEqual(["create", "destroy"]);
  });

  test("the fallback still renders — teardown does not swallow the error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    class Broken extends Component {
      render(): never {
        throw new Error("boom");
      }
    }
    class App extends Component {
      render() {
        return (
          <div>
            <ErrorBoundary fallback={() => <p id="fb">err</p>}>
              <Broken />
            </ErrorBoundary>
          </div>
        );
      }
    }

    const app = await getDOM(<App />);
    await settle();
    expect(app.container.querySelector("#fb")).toBeTruthy();
  });

  /**
   * Teardown is idempotent — asserted directly, because no component-level
   * scenario reaches it twice.
   *
   * The first version of this test mounted a component that fails and then
   * unmounted it, and claimed to cover double teardown. It did not: a component
   * that failed to build was never inserted, and the other way in
   * (`unmountChildrenNodes`) walks the DOM — so the two paths never meet, and the
   * test passed with the guard removed. Instrumented to count teardowns per
   * instance, the whole suite runs exactly one per component either way.
   *
   * So the invariant is stated against the function itself. It fails without the
   * guard, which the previous version did not.
   */
  test("running teardown twice runs @destroyed once", async () => {
    let destroys = 0;

    class Counted extends Component {
      @destroyed gone() {
        destroys++;
      }
      render() {
        return (
          <div>
            <span>x</span>
          </div>
        );
      }
    }

    const app = await getDOM(<Counted />);
    const host = app.container.firstElementChild!;
    const instance = instanceOf<Counted>(host);

    lifecycleCleanupManagement(instance);
    lifecycleCleanupManagement(instance);

    expect(destroys).toBe(1);
  });

  test("a healthy sibling is unaffected", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const log: string[] = [];

    class Fine extends Component {
      @created born() {
        log.push("fine:create");
      }
      @destroyed gone() {
        log.push("fine:destroy");
      }
      render() {
        return (
          <div>
            <span id="fine">fine</span>
          </div>
        );
      }
    }

    class Broken extends Component {
      render(): never {
        throw new Error("boom");
      }
    }

    class App extends Component {
      render() {
        return (
          <div>
            <Fine />
            <ErrorBoundary fallback={() => <p>err</p>}>
              <Broken />
            </ErrorBoundary>
          </div>
        );
      }
    }

    const app = await getDOM(<App />);
    await settle();

    expect(app.container.querySelector("#fine")).toBeTruthy();
    expect(log).toEqual(["fine:create"]); // still alive, not torn down
  });
});
