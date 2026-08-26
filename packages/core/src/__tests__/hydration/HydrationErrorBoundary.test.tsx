import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { Component } from "../../base/Component";
import { state, destroyed } from "../../base/decorators";
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
