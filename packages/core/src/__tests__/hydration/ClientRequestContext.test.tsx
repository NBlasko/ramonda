import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Component } from "../../base/Component";
import { state, created } from "../../base/decorators";
import { renderToString } from "../../hydration/ssr";
import { hydrateRoot } from "../../hydration/hydrate";
import { bootstrap } from "../../index";
import {
  requestContext,
  requestKey,
  seedRequest,
  setRequestScope,
  type RequestKey,
} from "../../hydration/requestContext";
import { resetDiagnostics } from "../../debug/diagnostics";
import { REQUEST_ATTR } from "../../helpers/constants";

/**
 * What the server EXPOSES reaches the browser, and nothing else does.
 *
 * Before this, nothing installed a request scope on the client at all: a component that read
 * `requestContext()` in `render()` worked on the server and THREW during hydration. Now the
 * exposed subset rides the root element, `hydrateRoot` installs it, and a read of anything that
 * was not exposed returns nothing and reports RMD025 instead of taking the page down.
 */

// Opted in: safe to publish.
const currentUser = requestKey<{ name: string } | null>("currentUser", { exposeToClient: true });
// Not opted in: stays on the server.
const sessionId = requestKey<string>("sessionId");

function captureCodes() {
  const codes: string[] = [];
  const handler = (e: Event) => {
    const m = ((e as CustomEvent).detail as { message?: string })?.message?.match(/^\[(RMD\d+)\]/);
    if (m) codes.push(m[1]);
  };
  window.addEventListener("ramonda:dev-log", handler);
  return { codes, stop: () => window.removeEventListener("ramonda:dev-log", handler) };
}

let cap: ReturnType<typeof captureCodes>;
beforeEach(() => {
  resetDiagnostics();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  cap = captureCodes();
});
afterEach(() => {
  cap.stop();
  vi.restoreAllMocks();
  setRequestScope(undefined);
  document.body.innerHTML = "";
});

// Seeded by the KEY. A label cannot be written here at all now — that is the point of the type.
const request = (values: [RequestKey<unknown>, unknown][]) => ({
  url: new URL("https://example.com/account"),
  cookies: new Map([["session", "secret-cookie"]]),
  values: new Map(values),
});

async function serverThenHydrate(
  vnode: Parameters<typeof renderToString>[0],
  values: [RequestKey<unknown>, unknown][],
) {
  const html = await renderToString(vnode, { request: request(values) });
  const container = document.createElement("div");
  document.body.appendChild(container);
  container.innerHTML = html;
  return { html, container };
}

describe("the server sends only what opted in", () => {
  test("an exposed key rides the root element; a non-exposed one does not", async () => {
    class Page extends Component {
      render() {
        return (
          <main>
            <p>x</p>
          </main>
        );
      }
    }

    const { html } = await serverThenHydrate(<Page />, [
      [currentUser, { name: "Ada" }],
      [sessionId, "s-123"],
    ]);

    expect(html).toContain(REQUEST_ATTR);
    expect(html).toContain("Ada");
    // The un-opted value never leaves the server — not in the blob, not anywhere in the page.
    expect(html).not.toContain("s-123");
  });

  test("nothing opted in → no blob at all", async () => {
    class Page extends Component {
      render() {
        return (
          <main>
            <p>x</p>
          </main>
        );
      }
    }
    const { html } = await serverThenHydrate(<Page />, [[sessionId, "s-123"]]);
    expect(html).not.toContain(REQUEST_ATTR);
  });

  /**
   * The lateness that used to be possible, and why it cannot happen now.
   *
   * `exposedLabels` was a module-level set that `requestKey` added to as a side effect, and the
   * serializer consulted it when stamping the page — so what a page exposed depended on whether
   * the module declaring the key had been IMPORTED yet. Measured against the old code: the same
   * render with the same seeded value emitted no blob before the declaration ran and a full one
   * after, which is what a key declared in a lazily-loaded route would have hit.
   *
   * **What closed it is the seed taking the KEY**, not exposure moving off the registry: you
   * cannot seed without holding the key, and holding it means `requestKey` has already run. The
   * registry became unreachable rather than wrong, and was deleted because dead state is worth
   * deleting. So this test asserts the property that survives — a key declared at any point is
   * exposed on the strength of itself — and deliberately does NOT claim to catch the old bug,
   * which no test can reach through this door any more.
   */
  test("exposure rides the key, whenever it was declared", async () => {
    const lateKey = requestKey<string>("declaredLate", { exposeToClient: true });

    class Page extends Component {
      render() {
        return (
          <main>
            <p>x</p>
          </main>
        );
      }
    }
    const { html } = await serverThenHydrate(<Page />, [[lateKey, "carried"]]);
    expect(html).toContain(REQUEST_ATTR);
    expect(html).toContain("carried");
  });

  /**
   * A value seeded DURING the render travels too, and this one is a real guard.
   *
   * `seedRequest` is the door for anything resolved once the render is under way, and it used to
   * lean on the same module-level registry for exposure. Moving exposure onto the scope meant this
   * call had to start marking it itself — and planting the missing line is caught by exactly this
   * test and nothing else in the suite, which is why it is here.
   */
  test("a value seeded mid-render is exposed on the strength of its own key", async () => {
    const midRender = requestKey<string>("midRender", { exposeToClient: true });
    const midRenderPrivate = requestKey<string>("midRenderPrivate");

    class Page extends Component {
      @created init() {
        seedRequest(midRender, "resolved-late");
        seedRequest(midRenderPrivate, "server-only");
      }
      render() {
        return (
          <main>
            <p>x</p>
          </main>
        );
      }
    }
    const { html } = await serverThenHydrate(<Page />, []);
    expect(html).toContain("resolved-late");
    expect(html).not.toContain("server-only");
  });

  test("a label cannot be seeded at all — only a key", async () => {
    class Page extends Component {
      render() {
        return (
          <main>
            <p>x</p>
          </main>
        );
      }
    }
    const { html } = await serverThenHydrate(<Page />, [
      // @ts-expect-error a label is not a key, which is the whole point of the type
      ["currentUser", { name: "Ada" }],
    ]);
    // It still renders — the guard is the type, not a runtime refusal, because at runtime a
    // string simply never matches a key and there is nothing to report.
    expect(html).toContain("x");
  });

  test("a cookie is never exposed, even when read during the render", async () => {
    class Page extends Component {
      @state seen = "";
      @created init() {
        this.seen = requestContext().cookies.get("session") ?? "";
      }
      render() {
        return (
          <main>
            <p>ok</p>
          </main>
        );
      }
    }
    const { html } = await serverThenHydrate(<Page />, [[currentUser, { name: "Ada" }]]);
    // It reached the server render (the @state proves the read worked) but is not in the blob.
    expect(html).toContain("secret-cookie"); // via @state, which the app chose to keep
    const root = document.body.querySelector(`[${REQUEST_ATTR}]`);
    expect(root?.getAttribute(REQUEST_ATTR)).not.toContain("secret-cookie");
  });
});

describe("the browser reads what was exposed", () => {
  test("get(key) returns the exposed value after hydration", async () => {
    class Page extends Component {
      render() {
        return (
          <main>
            <p>x</p>
          </main>
        );
      }
    }
    const { container } = await serverThenHydrate(<Page />, [[currentUser, { name: "Ada" }]]);

    hydrateRoot(<Page />, container);
    expect(requestContext().get(currentUser)).toEqual({ name: "Ada" });
    expect(cap.codes).not.toContain("RMD025");
  });

  test("THE BUG THIS FIXES: a direct read in render() survives hydration and matches", async () => {
    class Greeting extends Component {
      render() {
        return (
          <main>
            <h1>Hello {requestContext().get(currentUser)?.name ?? "guest"}</h1>
          </main>
        );
      }
    }

    const { html, container } = await serverThenHydrate(<Greeting />, [[currentUser, { name: "Ada" }]]);
    expect(html).toContain("Hello ");
    expect(html).toContain("Ada");

    // Used to throw "requestContext() was called outside a render".
    expect(() => hydrateRoot(<Greeting />, container)).not.toThrow();
    expect(container.textContent).toContain("Ada");
  });

  test("url reads live from the browser, not the server's frozen one", async () => {
    class Page extends Component {
      render() {
        return (
          <main>
            <p>x</p>
          </main>
        );
      }
    }
    const { container } = await serverThenHydrate(<Page />, [[currentUser, { name: "Ada" }]]);
    hydrateRoot(<Page />, container);
    expect(requestContext().url.href).toBe(window.location.href);
  });
});

describe("what was not exposed reports instead of throwing", () => {
  test("a non-exposed key reads as undefined and reports RMD025", async () => {
    class Page extends Component {
      render() {
        return (
          <main>
            <p>x</p>
          </main>
        );
      }
    }
    const { container } = await serverThenHydrate(<Page />, [[sessionId, "s-123"]]);
    hydrateRoot(<Page />, container);

    expect(requestContext().get(sessionId)).toBeUndefined();
    expect(cap.codes).toContain("RMD025");
  });

  test("cookies and headers read empty and report, never throw", async () => {
    class Page extends Component {
      render() {
        return (
          <main>
            <p>x</p>
          </main>
        );
      }
    }
    const { container } = await serverThenHydrate(<Page />, [[currentUser, { name: "Ada" }]]);
    hydrateRoot(<Page />, container);

    expect(requestContext().cookies.get("session")).toBeUndefined();
    expect(requestContext().cookies.has("session")).toBe(false);
    expect([...requestContext().headers.keys()]).toEqual([]);
    expect(cap.codes).toContain("RMD025");
  });

  test("a client-only app (bootstrap, no SSR) reads empty rather than throwing", () => {
    class Page extends Component {
      render() {
        return (
          <main>
            <p>x</p>
          </main>
        );
      }
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    bootstrap(<Page />, container);

    expect(() => requestContext().get(currentUser)).not.toThrow();
    expect(requestContext().get(currentUser)).toBeUndefined();
    expect(cap.codes).toContain("RMD025");
  });
});
