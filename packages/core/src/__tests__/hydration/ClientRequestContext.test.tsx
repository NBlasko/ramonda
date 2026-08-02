import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Component } from "../../base/Component";
import { Host, state, create } from "../../base/decorators";
import { renderToString } from "../../hydration/ssr";
import { hydrateRoot } from "../../hydration/hydrate";
import { bootstrap } from "../../index";
import { requestContext, requestKey, setRequestScope } from "../../hydration/requestContext";
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

const request = (values: [string, unknown][]) => ({
  url: new URL("https://example.com/account"),
  cookies: new Map([["session", "secret-cookie"]]),
  values: new Map(values),
});

async function serverThenHydrate(vnode: Parameters<typeof renderToString>[0], values: [string, unknown][]) {
  const html = await renderToString(vnode, { request: request(values) });
  const container = document.createElement("div");
  document.body.appendChild(container);
  container.innerHTML = html;
  return { html, container };
}

describe("the server sends only what opted in", () => {
  test("an exposed key rides the root element; a non-exposed one does not", async () => {
    @Host("main")
    class Page extends Component {
      render() {
        return <p>x</p>;
      }
    }

    const { html } = await serverThenHydrate(<Page />, [
      ["currentUser", { name: "Ada" }],
      ["sessionId", "s-123"],
    ]);

    expect(html).toContain(REQUEST_ATTR);
    expect(html).toContain("Ada");
    // The un-opted value never leaves the server — not in the blob, not anywhere in the page.
    expect(html).not.toContain("s-123");
  });

  test("nothing opted in → no blob at all", async () => {
    @Host("main")
    class Page extends Component {
      render() {
        return <p>x</p>;
      }
    }
    const { html } = await serverThenHydrate(<Page />, [["sessionId", "s-123"]]);
    expect(html).not.toContain(REQUEST_ATTR);
  });

  test("a cookie is never exposed, even when read during the render", async () => {
    @Host("main")
    class Page extends Component {
      @state seen = "";
      @create init() {
        this.seen = requestContext().cookies.get("session") ?? "";
      }
      render() {
        return <p>ok</p>;
      }
    }
    const { html } = await serverThenHydrate(<Page />, [["currentUser", { name: "Ada" }]]);
    // It reached the server render (the @state proves the read worked) but is not in the blob.
    expect(html).toContain("secret-cookie"); // via @state, which the app chose to keep
    const root = document.body.querySelector(`[${REQUEST_ATTR}]`);
    expect(root?.getAttribute(REQUEST_ATTR)).not.toContain("secret-cookie");
  });
});

describe("the browser reads what was exposed", () => {
  test("get(key) returns the exposed value after hydration", async () => {
    @Host("main")
    class Page extends Component {
      render() {
        return <p>x</p>;
      }
    }
    const { container } = await serverThenHydrate(<Page />, [["currentUser", { name: "Ada" }]]);

    hydrateRoot(<Page />, container);
    expect(requestContext().get(currentUser)).toEqual({ name: "Ada" });
    expect(cap.codes).not.toContain("RMD025");
  });

  test("THE BUG THIS FIXES: a direct read in render() survives hydration and matches", async () => {
    @Host("main")
    class Greeting extends Component {
      render() {
        return <h1>Hello {requestContext().get(currentUser)?.name ?? "guest"}</h1>;
      }
    }

    const { html, container } = await serverThenHydrate(<Greeting />, [["currentUser", { name: "Ada" }]]);
    expect(html).toContain("Hello ");
    expect(html).toContain("Ada");

    // Used to throw "requestContext() was called outside a render".
    expect(() => hydrateRoot(<Greeting />, container)).not.toThrow();
    expect(container.textContent).toContain("Ada");
  });

  test("url reads live from the browser, not the server's frozen one", async () => {
    @Host("main")
    class Page extends Component {
      render() {
        return <p>x</p>;
      }
    }
    const { container } = await serverThenHydrate(<Page />, [["currentUser", { name: "Ada" }]]);
    hydrateRoot(<Page />, container);
    expect(requestContext().url.href).toBe(window.location.href);
  });
});

describe("what was not exposed reports instead of throwing", () => {
  test("a non-exposed key reads as undefined and reports RMD025", async () => {
    @Host("main")
    class Page extends Component {
      render() {
        return <p>x</p>;
      }
    }
    const { container } = await serverThenHydrate(<Page />, [["sessionId", "s-123"]]);
    hydrateRoot(<Page />, container);

    expect(requestContext().get(sessionId)).toBeUndefined();
    expect(cap.codes).toContain("RMD025");
  });

  test("cookies and headers read empty and report, never throw", async () => {
    @Host("main")
    class Page extends Component {
      render() {
        return <p>x</p>;
      }
    }
    const { container } = await serverThenHydrate(<Page />, [["currentUser", { name: "Ada" }]]);
    hydrateRoot(<Page />, container);

    expect(requestContext().cookies.get("session")).toBeUndefined();
    expect(requestContext().cookies.has("session")).toBe(false);
    expect([...requestContext().headers.keys()]).toEqual([]);
    expect(cap.codes).toContain("RMD025");
  });

  test("a client-only app (bootstrap, no SSR) reads empty rather than throwing", () => {
    @Host("main")
    class Page extends Component {
      render() {
        return <p>x</p>;
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
