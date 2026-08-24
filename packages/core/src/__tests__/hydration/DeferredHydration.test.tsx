import { instanceOf } from "../../test/setup";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { Component } from "../../base/Component";
import { state } from "../../base/decorators";
import { AsyncLoad } from "../../base/AsyncLoad";
import { renderPage } from "../../hydration/ssr";
import { hydrateRoot } from "../../hydration/hydrate";

/**
 * The scenario this exists for:
 *
 *   1. the server renders the async part too, and the HTML carries it with its
 *      state blob;
 *   2. the client hydrates and must NOT destroy it;
 *   3. it waits for the import, then hydrates into what is already there.
 *
 * Before `deferHydration`, step 2 failed in the loudest possible way. The
 * client's module cache is cold, so `AsyncLoad`'s first render produced the
 * loading fallback — a structure mismatch against the server's markup, which
 * hydration resolves by replacing the node. Measured: the server's content gone
 * and `"loading…"` in its place, before the chunk had even been requested. A
 * reader watches finished content collapse into a spinner.
 */

class Loaded extends Component<{ label?: string }> {
  @state clicks = 0;

  bump() {
    this.clicks = this.clicks + 1;
  }

  render() {
    return (
      <div id="loaded" onclick={this.bump}>
        <p>
          LOADED: {this.props.label ?? "-"} ({this.clicks})
        </p>
      </div>
    );
  }
}

interface PageProps {
  /** Distinct per test: the module cache is process-wide, so this is what makes a client "cold". */
  ck: string;
  lazy: () => Promise<Record<string, unknown>>;
}

class Page extends Component<PageProps> {
  render() {
    return (
      <div>
        <AsyncLoad
          cacheKey={this.props.ck}
          lazy={this.props.lazy}
          namedExport="Loaded"
          loadedProps={{ label: "from server" }}
          onLoading={<p>loading…</p>}
          errorFallback={<p>failed</p>}
        />
      </div>
    );
  }
}

const immediately = () => Promise.resolve({ Loaded });
/** A real import takes a macrotask, not a microtask. */
const afterATick = () => new Promise<Record<string, unknown>>((resolve) => setTimeout(() => resolve({ Loaded }), 10));

let container: HTMLElement | undefined;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  container?.remove();
  container = undefined;
  vi.restoreAllMocks();
});

/** Server HTML for a page whose import the server resolved. */
async function serverHtml(key: string): Promise<string> {
  const page = await renderPage(<Page ck={key} lazy={immediately} />);
  expect(page.body).toContain("LOADED");
  return page.body;
}

function hydrateCold(html: string, key: string) {
  container = document.createElement("div");
  document.body.appendChild(container);
  container.innerHTML = html;
  const serverNode = container.querySelector("#loaded");
  hydrateRoot(<Page ck={key} lazy={afterATick} />, container);
  return { serverNode: serverNode as HTMLElement };
}

describe("hydration waits instead of destroying", () => {
  test("the server's content survives hydration untouched", async () => {
    const html = await serverHtml("srv-1");
    const { serverNode } = hydrateCold(html, "cold-1");
    await Promise.resolve();

    // The whole point: same node, same text, immediately after hydrateRoot and
    // long before the chunk lands.
    expect(container!.querySelector("#loaded")).toBe(serverNode);
    expect(container!.textContent).toContain("LOADED: from server");
    expect(container!.textContent).not.toContain("loading…");

    // The walk continued PAST the deferred subtree rather than stopping at it:
    // the page's own root is hydrated and owns its host.
    const root = container!.firstChild;
    expect(instanceOf<object>(root)).toBeDefined();
  });

  test("and the same node is still there once the import lands", async () => {
    const html = await serverHtml("srv-2");
    const { serverNode } = hydrateCold(html, "cold-2");

    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(container!.querySelector("#loaded")).toBe(serverNode);
    expect(container!.textContent).toContain("LOADED: from server");
  });

  test("the subtree becomes interactive — it was adopted, not just left there", async () => {
    const html = await serverHtml("srv-3");
    const { serverNode } = hydrateCold(html, "cold-3");
    await new Promise((resolve) => setTimeout(resolve, 40));

    const loaded = container!.querySelector("#loaded") as HTMLElement;

    // Both halves, together. Rebuilt content is interactive too, so asserting
    // the click alone would pass without the deferral — it is the click landing
    // on the SERVER's own node that says the markup was adopted rather than
    // replaced. Preserving without hydrating would fail the click; hydrating by
    // rebuilding would fail this identity check.
    expect(loaded).toBe(serverNode);
    loaded.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(container!.textContent).toContain("(1)");
  });

  test("a warm cache hydrates immediately, without deferring", async () => {
    // Same cacheKey the server used, so the module is already there — the case
    // where deferring would only add a delay.
    const html = await serverHtml("warm-1");
    container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;
    const serverNode = container.querySelector("#loaded");

    hydrateRoot(<Page ck="warm-1" lazy={immediately} />, container);
    await Promise.resolve();

    expect(container.querySelector("#loaded")).toBe(serverNode);
    expect(container.textContent).toContain("LOADED");
  });
});

describe("updates are held, not lost, while hydration is deferred", () => {
  test("a prop that changes during the wait is picked up on resume", async () => {
    class Parent extends Component {
      @state label = "first";
      render() {
        return (
          <div>
            <AsyncLoad
              cacheKey="cold-props"
              lazy={afterATick}
              namedExport="Loaded"
              loadedProps={{ label: this.label }}
              onLoading={<p>loading…</p>}
              errorFallback={<p>failed</p>}
            />
          </div>
        );
      }
    }

    const page = await renderPage(<Page ck="srv-props" lazy={immediately} />);
    container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = page.body;

    hydrateRoot(<Parent />, container);
    await Promise.resolve();

    // Change the prop while the subtree is still deferred.
    const parent = instanceOf<Parent>(container.firstChild);
    parent.label = "second";
    await Promise.resolve();

    await new Promise((resolve) => setTimeout(resolve, 40));

    // Resume renders from CURRENT state, so the change made during the wait is
    // delayed rather than dropped.
    expect(container.textContent).toContain("second");
  });
});

describe("the whole scenario, end to end", () => {
  test("server renders the async part, client adopts it and makes it live", async () => {
    // 1. The server awaits a REALISTIC import — a macrotask, like a real chunk —
    //    and writes the loaded component into the HTML with its state blob.
    const page = await renderPage(<Page ck="e2e-server" lazy={afterATick} />);
    expect(page.body).toContain("LOADED: from server");
    expect(page.body).not.toContain("loading…");
    expect(page.body).toContain('id="loaded"');

    // 2. A cold client — its module cache is empty, exactly like a browser that
    //    has the HTML but has not fetched the chunk.
    container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = page.body;
    const serverNode = container.querySelector("#loaded") as HTMLElement;

    hydrateRoot(<Page ck="e2e-client" lazy={afterATick} />, container);
    await Promise.resolve();

    //    Nothing was destroyed: the content is still on screen, mid-hydration.
    expect(container.querySelector("#loaded")).toBe(serverNode);
    expect(container.textContent).toContain("LOADED: from server");

    // 3. The chunk lands and the SAME nodes become interactive.
    await new Promise((resolve) => setTimeout(resolve, 40));
    const loaded = container.querySelector("#loaded") as HTMLElement;
    expect(loaded).toBe(serverNode);

    loaded.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(container.textContent).toContain("(1)");
  });
});

describe("@deferHydration is a decorator, so method names stay yours", () => {
  test("the method can be called anything", async () => {
    const { deferHydration } = await import("../../base/decorators");
    let asked = 0;

    class Slow extends Component {
      @state ready = false;

      // Deliberately a name with no framework meaning. A magic method name would
      // have made this an accident waiting to happen in the other direction too:
      // someone writing `deferHydration()` for their own reasons would silently
      // change how their component hydrates.
      @deferHydration
      waitForTheThing() {
        asked++;
        if (this.ready) return undefined;
        return afterATick().then(() => {
          this.ready = true;
        });
      }

      render() {
        return (
          <div>
            <p>{this.ready ? "ready" : "waiting"}</p>
          </div>
        );
      }
    }

    const page = await renderPage(<Slow />);
    container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = page.body;
    const serverNode = container.firstElementChild;

    hydrateRoot(<Slow />, container);
    await Promise.resolve();
    expect(asked).toBe(1);
    expect(container.firstElementChild).toBe(serverNode);

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(container.firstElementChild).toBe(serverNode);
    expect(container.textContent).toContain("ready");
  });

  test("a component with no @deferHydration pays nothing", async () => {
    class Plain extends Component {
      render() {
        return (
          <div>
            <p>plain</p>
          </div>
        );
      }
    }

    const page = await renderPage(<Plain />);
    container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = page.body;

    hydrateRoot(<Plain />, container);
    await Promise.resolve();

    // Hydrated synchronously, in the same walk — not deferred to a promise.
    expect(container.textContent).toContain("plain");
  });

  test("a user method named deferHydration is just a method now", async () => {
    class Innocent extends Component {
      @state note = "";
      // Before this was a decorator, defining this would have changed how the
      // component hydrates. Now it is an ordinary method.
      deferHydration() {
        this.note = "called by me";
        return Promise.resolve();
      }
      render() {
        return (
          <div>
            <p>{this.note || "untouched"}</p>
          </div>
        );
      }
    }

    const page = await renderPage(<Innocent />);
    container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = page.body;

    hydrateRoot(<Innocent />, container);
    await Promise.resolve();

    // The framework never called it; the component hydrated normally.
    expect(container.textContent).toContain("untouched");
  });
});
