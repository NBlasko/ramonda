import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { Component } from "../../base/Component";
import { state, destroyed, deferHydration } from "../../base/decorators";
import { list } from "../../base/list";
import { ErrorBoundary } from "../../base/ErrorBoundary";
import { renderToString } from "../../hydration/ssr";
import { hydrateRoot } from "../../hydration/hydrate";

/**
 * A render that throws while the page is being ADOPTED.
 *
 * The build path has had a door for this since there was one: a component that throws is dropped
 * from the render, `errorHandler` walks up to an `ErrorBoundary`, and the boundary's re-render puts
 * the fallback where the child was. Hydration had none — the throw went straight out of
 * `hydrateRoot`, so the page was left exactly as the server sent it: every marker still in the DOM,
 * nothing adopted, no listener attached, and the boundary two lines above it never told. The page
 * LOOKS finished and is inert, which is the worst way for this to fail.
 *
 * It is not an exotic shape either: a component that renders on the server and throws on the client
 * is what a `typeof window` branch does when the client half is wrong.
 */

let SIDE = "server";

beforeEach(() => {
  SIDE = "server";
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function servedInto(vnode: Parameters<typeof renderToString>[0]) {
  const html = await renderToString(vnode);
  const container = document.createElement("div");
  document.body.appendChild(container);
  container.innerHTML = html;
  return container;
}

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("a throw while hydrating", () => {
  test("reaches the boundary, and the siblings after it survive", async () => {
    class Broken extends Component {
      render() {
        if (SIDE === "client") throw new Error("boom on hydrate");
        return <b id="broken">broken</b>;
      }
    }

    class Page extends Component {
      render() {
        return (
          <div id="shell">
            <ErrorBoundary fallback={() => <i id="fb">fallback</i>}>
              <Broken />
            </ErrorBoundary>
            <span id="after">after</span>
          </div>
        );
      }
    }

    const container = await servedInto(<Page />);
    expect(container.querySelector("#broken")).not.toBeNull();

    SIDE = "client";
    // No throw out of hydrateRoot: this used to abort the whole page.
    hydrateRoot(<Page />, container);
    await settle();

    expect(container.innerHTML).toBe('<div id="shell"><i id="fb">fallback</i><span id="after">after</span></div>');
  });

  test("the rest of the page is still adopted and live", async () => {
    class Broken extends Component {
      render() {
        if (SIDE === "client") throw new Error("boom on hydrate");
        return <b id="broken">broken</b>;
      }
    }

    class Counter extends Component {
      @state n = 0;
      bump() {
        this.n++;
      }
      render() {
        return (
          <button id="count" onclick={this.bump}>
            {String(this.n)}
          </button>
        );
      }
    }

    class Page extends Component {
      render() {
        return (
          <div id="shell">
            <ErrorBoundary fallback={() => <i id="fb">fallback</i>}>
              <Broken />
            </ErrorBoundary>
            <Counter />
          </div>
        );
      }
    }

    const container = await servedInto(<Page />);
    const button = container.querySelector("#count")!;

    SIDE = "client";
    hydrateRoot(<Page />, container);
    await settle();

    // The same node the server sent — adopted, not rebuilt — and its listener is attached.
    expect(container.querySelector("#count")).toBe(button);
    (button as HTMLElement).click();
    await settle();
    expect(container.querySelector("#count")!.textContent).toBe("1");
  });

  test("a throw from DEEPER in the adoption still takes only its own block", async () => {
    /**
     * The throw comes from a list mapper, which runs while the component's own children are being
     * walked — so the shared cursor is already INSIDE its block when it unwinds.
     *
     * That is the case the first version of this repair missed. It read the block to remove off the
     * CURSOR, which is a marker only for a throw raised from `render()` itself; from deeper in, the
     * cursor is an ordinary node and the guard did nothing. Measured: the failing component's
     * opening marker stayed in the page still carrying its state blob, the enclosing component took
     * the failing one's close for its own, and the next sibling was built fresh beside the server's
     * untouched copy of it — two `<p id="foot">`.
     */
    class Card extends Component {
      @state rows = ["a", "b"];
      render() {
        return [
          <h1 id="card">Card</h1>,
          list(this.rows, (row: string) => {
            if (SIDE === "client") throw new Error("mapper boom");
            return <li>{row}</li>;
          }),
        ];
      }
    }

    class Footer extends Component {
      render() {
        return <p id="foot">foot</p>;
      }
    }

    class Page extends Component {
      render() {
        return (
          <div id="shell">
            <ErrorBoundary fallback={() => <i id="fb">fb</i>}>
              <Card />
            </ErrorBoundary>
            <Footer />
          </div>
        );
      }
    }

    const container = await servedInto(<Page />);
    expect(container.querySelectorAll("li")).toHaveLength(2);

    SIDE = "client";
    hydrateRoot(<Page />, container);
    await settle();

    // Exactly one footer, adopted rather than rebuilt beside the server's, and nothing of the
    // failing component left — no stale `<h1>`, no marker, no state blob.
    expect(container.innerHTML).toBe('<div id="shell"><i id="fb">fb</i><p id="foot">foot</p></div>');
  });

  test("a throw when a DEFERRED subtree resumes reaches the boundary too", async () => {
    /**
     * The one path with no caller to catch anything: the resume is reached through
     * `void deferred.finally(…)`, so a throw there became an unhandled rejection and nothing else
     * happened. The block stayed in the page for the life of it, markers and all — and nothing still
     * knew the subtree was unhydrated, because the pending flag, the stalled watch and the
     * `deferredBlocks` entry are all cleared before the render.
     *
     * A deferred subtree is where a client-only render is likeliest to be wrong: it is deferred
     * because the client could not render it yet.
     */
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    class Boom extends Component {
      @deferHydration wait() {
        return gate;
      }
      render() {
        if (SIDE === "client") throw new Error("client only");
        return <div id="boom">server</div>;
      }
    }

    class Page extends Component {
      render() {
        return (
          <div id="shell">
            <ErrorBoundary fallback={() => <i id="fb">fb</i>}>
              <Boom />
            </ErrorBoundary>
            <b id="after">after</b>
          </div>
        );
      }
    }

    const container = await servedInto(<Page />);
    expect(container.querySelector("#boom")).not.toBeNull();

    SIDE = "client";
    hydrateRoot(<Page />, container);
    await settle();

    // Still waiting: the server's markup is untouched and its markers are held.
    expect(container.querySelector("#boom")).not.toBeNull();

    release();
    await settle();
    await settle();

    expect(container.innerHTML).toBe('<div id="shell"><i id="fb">fb</i><b id="after">after</b></div>');
  });

  test("a component the server never wrote, whose render also throws", async () => {
    /**
     * The one branch of the adoption that has no block to take out: the client renders a component
     * where the server wrote no marker, so it is BUILT — and the build throws.
     *
     * `buildComponentRegion`'s own catch releases the instance and rethrows, and there is nothing of
     * this component's in the markup to remove, so all that is left is to put the error where the
     * build path puts it. Written because it is the error path of the repair above, and a repair's
     * own error path is where the last two rounds found their faults.
     */
    class Missing extends Component {
      render(): never {
        throw new Error("built and broken");
      }
    }

    class Page extends Component {
      render() {
        return (
          <div id="shell">
            <ErrorBoundary fallback={() => <i id="fb">fb</i>}>{SIDE === "client" ? <Missing /> : null}</ErrorBoundary>
            <b id="after">after</b>
          </div>
        );
      }
    }

    const container = await servedInto(<Page />);
    expect(container.querySelector("#fb")).toBeNull();

    SIDE = "client";
    hydrateRoot(<Page />, container);
    await settle();

    // The boundary took it, and the sibling after the boundary is untouched.
    expect(container.innerHTML).toBe('<div id="shell"><i id="fb">fb</i><b id="after">after</b></div>');
  });

  test("what the server wrote for the throwing component is taken out", async () => {
    const gone: string[] = [];

    class Inner extends Component {
      @destroyed bye() {
        gone.push("Inner");
      }
      render() {
        return <em id="inner">inner</em>;
      }
    }

    class Broken extends Component {
      render() {
        if (SIDE === "client") throw new Error("boom on hydrate");
        return (
          <b id="broken">
            <Inner />
          </b>
        );
      }
    }

    class Page extends Component {
      render() {
        return (
          <div id="shell">
            <ErrorBoundary fallback={() => <i id="fb">fallback</i>}>
              <Broken />
            </ErrorBoundary>
          </div>
        );
      }
    }

    const container = await servedInto(<Page />);
    expect(container.querySelector("#inner")).not.toBeNull();

    SIDE = "client";
    hydrateRoot(<Page />, container);
    await settle();

    // Its whole block goes, nested markers and all: stale content under a fallback is not a repair.
    expect(container.querySelector("#broken")).toBeNull();
    expect(container.querySelector("#inner")).toBeNull();
    expect(container.innerHTML).not.toContain("<!--");
  });
});
