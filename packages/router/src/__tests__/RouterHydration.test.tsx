import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { Component, renderToString } from "@ramonda/core";
import type { RamondaNode } from "@ramonda/core";
import { render } from "@ramonda/testing-library";
import { Router, RouteOutlet, Navigator } from "../Router";
import { scanComponentTree } from "../../../core/src/debug/inspector";
import { createRoutes } from "../match";

/**
 * The client's URL wins over whatever the server put in the state blob.
 *
 * `Router.routeState` is a plain `@state` field, and `@state` auto-persists —
 * `serialize.ts` collects STATE_KEYS, and hooks are walked recursively — so the
 * server's route travels to the client inside the blob and is restored there
 * BEFORE any client lifecycle runs.
 *
 * That is why `init()` re-reads the URL:
 *
 *   1. field initializer  -> parseUrl()      (the client's URL)
 *   2. restore from blob  -> the SERVER's route  ← overwrites (1)
 *   3. @created init()     -> parseUrl()      (the client's URL again)
 *
 * Without step 3 a client that hydrates at a different URL than the server
 * rendered — a cached page, a CDN serving one document for many paths, a client
 * redirect between request and hydration — keeps the server's route and renders
 * the wrong page with no error.
 *
 * A TODO on that line asked whether setting it twice was redundant. It is not —
 * but proving that took two tries, and the first try is the lesson:
 *
 * Removing step 3 and checking the RENDERED page passes. The first render is
 * correct anyway, because `RouteProvider`'s options are captured when the hook is
 * constructed (`useCommon` calls the options callback immediately), which is
 * before the blob is restored. So the DOM is right while `routeState` itself
 * holds the SERVER's route:
 *
 *   without step 3:  routeState.baseUrl = "/players"   rendered = home
 *   with step 3:     routeState.baseUrl = "/"          rendered = home
 *
 * A test that only reads the DOM cannot see that, and the whole router suite
 * stayed green with the line deleted. The state is the thing to assert, plus
 * what happens the first time anything reads it back.
 */

class Home extends Component {
  render() {
    return (
      <div>
        <span id="home">home</span>
      </div>
    );
  }
}

class Players extends Component {
  hook = this.use(Navigator);
  render() {
    return (
      <div>
        <span id="players">players</span>
      </div>
    );
  }
}

const routes = createRoutes({
  "/": <Home />,
  "/players": <Players />,
});

class App extends Component<{ children?: RamondaNode }> {
  router = this.use(Router);
  render() {
    return (
      <div>
        <RouteOutlet routes={routes} />
      </div>
    );
  }
}

function setUrl(pathname: string): void {
  window.history.pushState(null, "", pathname);
}

/** The Router hook's `routeState.baseUrl`, read off the live component tree. */
function baseUrlFrom(container: HTMLElement): string | undefined {
  const node = scanComponentTree(container)[0];
  const routerHook = node.hooks.find((h) => h.name === "Router");
  expect(routerHook).toBeDefined();
  return (routerHook?.state as { routeState?: { baseUrl?: string } })?.routeState?.baseUrl;
}

/**
 * There used to be a `withHydrated` helper here wrapping `unmount` in a
 * `finally`, because a cleanup after the assertions is skipped when one throws
 * and the surviving Router made every later test fail with "a second Router was
 * mounted". `render(ui, { hydrate: html })` takes the markup, owns the
 * container, and `@ramonda/testing-library` unmounts it after the test whether
 * it passed or not — so the helper is gone.
 */
describe("Router hydration", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    setUrl("/");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("the client's URL wins over the route restored from the server", async () => {
    // Server renders /players.
    setUrl("/players");
    const html = await renderToString(<App />);
    expect(html).toContain("players");

    // The document that reaches the browser is being hydrated at a DIFFERENT
    // path — the case the blob would otherwise win.
    setUrl("/");

    const { container } = render(<App />, { hydrate: html });

    expect(container.querySelector("#home")).toBeTruthy();
    expect(container.querySelector("#players")).toBeNull();

    // Re-measured 2026-07-22 with the re-read removed: `rendered: players |
    // routeState.baseUrl: /players`. The DOM is NOT right either way any more —
    // the `#home` assertion above now catches it first. That changed when
    // hydration started refreshing hook options after the state restore, which
    // means `RouteProvider` publishes the SERVER's route rather than the seed.
    // This assertion stays because it is the one that names the actual defect;
    // the one above only shows the consequence.
    expect(baseUrlFrom(container)).toBe("/");
  });

  test("hydrating at the same URL keeps the server's route", async () => {
    setUrl("/players");
    const html = await renderToString(<App />);

    const { container } = render(<App />, { hydrate: html });

    expect(container.querySelector("#players")).toBeTruthy();
    expect(baseUrlFrom(container)).toBe("/players");
  });
});
