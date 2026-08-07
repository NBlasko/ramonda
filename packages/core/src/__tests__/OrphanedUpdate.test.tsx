import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, state, Ref, bootstrap, unmount } from "../index";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * RMD016 — a component still mounted inside DOM that is no longer in the
 * document. It keeps rendering, its timers keep firing, its listeners stay
 * attached, and `@destroyed` never runs.
 *
 * This is NOT reachable from inside a pure Ramonda app: every path that removes
 * something goes through the diff, which unmounts. It is a boundary problem —
 * a `ref` handed to a library that clears the node, an embedded app whose host
 * page removes the mount point, a hand-written `innerHTML`.
 *
 * The false-positive that shaped the design: a tree built detached and inserted
 * later is legitimate, so this reports and lets the update through rather than
 * refusing it.
 */

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

let codes: string[] = [];
const handler = (event: Event) => {
  const message = (event as CustomEvent).detail?.message as string;
  const code = message?.match(/^\[(RMD\d+)\]/)?.[1];
  if (code) codes.push(code);
};

beforeEach(() => {
  codes = [];
  resetDiagnostics();
  window.addEventListener("ramonda:dev-log", handler);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  window.removeEventListener("ramonda:dev-log", handler);
  vi.restoreAllMocks();
});

@Host("div")
class Widget extends Component {
  @state n = 0;
  bump() {
    this.n++;
  }
  render() {
    return <span>{String(this.n)}</span>;
  }
}

describe("RMD016: updating an orphaned tree", () => {
  test("reports when a library clears a subtree it was handed", async () => {
    class App extends Component {
      slot = new Ref<HTMLElement>();
      widget?: Widget;
      render() {
        return (
          <div>
            <div ref={this.slot}>
              <Widget />
            </div>
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    const host = app.instance.slot.current!.firstElementChild!;
    const widget = (host as { _componentInstance?: Widget })._componentInstance!;

    // What a chart / modal / drag-and-drop library does to a node it owns.
    app.instance.slot.current!.innerHTML = "";

    widget.bump();
    await tick();

    expect(codes).toContain("RMD016");
  });

  /**
   * The update must still happen. Refusing it would break a tree that is
   * detached on purpose, and a diagnostic must not change behaviour.
   */
  test("the update still runs — this reports, it does not block", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    bootstrap(<Widget />, container);

    const host = container.firstElementChild!;
    const widget = (host as { _componentInstance?: Widget })._componentInstance!;

    container.remove(); // orphaned: still mounted, no longer in the document

    widget.bump();
    await tick();

    expect(codes).toContain("RMD016");
    expect(host.textContent).toBe("1"); // rendered anyway

    unmount(container);
  });

  test("silent for a normal update in a connected tree", async () => {
    class App extends Component {
      @state n = 0;
      render() {
        return <div>{String(this.n)}</div>;
      }
    }

    const app = await getDOM<App>(<App />);
    app.instance.n = 1;
    await app.settle();
    await tick();

    expect(codes).not.toContain("RMD016");
  });

  /**
   * The case that must stay silent, and the reason the check runs at DRAIN time
   * rather than when the update is queued: `isInitialized` is set before the host
   * element is built, and the caller inserts it after that — so during a commit a
   * healthy component is briefly disconnected.
   */
  test("silent for a component removed the normal way", async () => {
    class App extends Component {
      @state show = true;
      render() {
        return <div>{this.show ? <Widget /> : null}</div>;
      }
    }

    const app = await getDOM<App>(<App />);
    app.instance.show = false;
    await app.settle();
    await tick();

    expect(codes).not.toContain("RMD016");
  });

  test("silent during the initial mount of a nested tree", async () => {
    class Deep extends Component {
      render() {
        return <span>deep</span>;
      }
    }
    class Middle extends Component {
      render() {
        return (
          <div>
            <Deep />
          </div>
        );
      }
    }
    class App extends Component {
      @state n = 0;
      render() {
        return (
          <div>
            <Middle />
            {String(this.n)}
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    app.instance.n = 1;
    await app.settle();
    await tick();

    expect(codes).not.toContain("RMD016");
  });
});
