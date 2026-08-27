import { describe, test, expect, vi, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { state, mounted, updated } from "../base/decorators";
import { Component } from "../base/Component";
import { bootstrap, unmount } from "../index";

/**
 * One component's throw must not cost the others their commit.
 *
 * `errorHandler` RETHROWS an error no `ErrorBoundary` claims — that is right, it is the app's own
 * error on its way to the console with its real stack. But both commit loops sat between that throw
 * and the rest of the tree's work, and both let it escape: the queue was left half-drained, with no
 * later render to pick it up.
 *
 * Neither of these is an exotic shape. A `@mounted` that reads a DOM measurement, or an `@updated`
 * that touches an API the browser refuses, throws exactly like this.
 */

const log: string[] = [];
let host: HTMLElement | undefined;

afterEach(() => {
  if (host) {
    unmount(host);
    host.remove();
    host = undefined;
  }
  vi.restoreAllMocks();
});

describe("a throw in the commit window", () => {
  test("does not stop the @mounted of the components after it", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    log.length = 0;

    class Boom extends Component {
      @mounted go() {
        log.push("boom");
        throw new Error("mount boom");
      }
      render() {
        return <b id="boom">b</b>;
      }
    }

    class After extends Component {
      @mounted go() {
        log.push("after");
      }
      render() {
        return <i id="after">a</i>;
      }
    }

    class App extends Component {
      render() {
        return (
          <div id="app">
            <Boom />
            <After />
          </div>
        );
      }
    }

    host = document.createElement("div");
    document.body.appendChild(host);

    let threw = "";
    try {
      bootstrap(<App />, host);
    } catch (e) {
      threw = (e as Error).message;
    }

    // The error still reaches the app — it is not swallowed …
    expect(threw).toBe("mount boom");
    // … and `After` is mounted rather than sitting in the page with its `@mounted` never run.
    expect(log).toEqual(["boom", "after"]);
    expect(host.querySelector("#after")).not.toBeNull();
  });

  test("does not discard the @updated of every other component in the commit", async () => {
    /**
     * Worse than the `@mounted` case, because nothing recovers it: `flushUpdated` snapshots and
     * CLEARS the pending set up front, so what has not run is only in a local array. Measured on
     * three rows with the middle one throwing: `u3` alone, and no later render brought the others
     * back.
     */
    log.length = 0;

    class Row extends Component<{ n: number; tick: number; boom?: boolean }> {
      @updated bump() {
        log.push(`u${this.props.n}`);
        if (this.props.boom) throw new Error("updated boom");
      }
      render() {
        return (
          <b>
            {String(this.props.n)}:{String(this.props.tick)}
          </b>
        );
      }
    }

    class App extends Component {
      @state tick = 0;
      render() {
        return (
          <div id="app">
            <Row n={1} tick={this.tick} />
            <Row n={2} tick={this.tick} boom />
            <Row n={3} tick={this.tick} />
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();
    log.length = 0;

    app.instance.tick = 1;
    let threw = "";
    try {
      await app.settle();
    } catch (e) {
      threw = (e as Error).message;
    }

    expect(threw).toBe("updated boom");
    // Deepest first, and every one of them ran — the thrower does not end the pass.
    expect(log).toEqual(["u3", "u2", "u1"]);
  });
});
