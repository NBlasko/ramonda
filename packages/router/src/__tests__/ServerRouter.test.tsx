import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { Component, Host, renderToString } from "@ramonda/core";
import type { RamondaNode } from "@ramonda/core";
import { Router, RouteOutlet } from "../Router";
import { createRoutes } from "../match";

/**
 * Nothing here mounts, so there is nothing for `@ramonda/testing-library` to do:
 * `renderToString` returns a string and never touches the document. That is the
 * point of these two tests — the bugs they lock were both about work leaking
 * from the client path into a server render.
 */

@Host("div")
class Home extends Component {
  render() {
    return <span>home</span>;
  }
}

const routes = createRoutes({ "/": <Home /> });

@Host("div")
class App extends Component<{ children?: RamondaNode }> {
  router = this.use(Router);
  render() {
    return (
      <div className="app">
        <RouteOutlet routes={routes} />
      </div>
    );
  }
}

describe("Router on the server", () => {
  const realAdd = window.addEventListener.bind(window);
  let popstateListeners: number;

  beforeEach(() => {
    popstateListeners = 0;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(window, "addEventListener").mockImplementation((...args) => {
      if (args[0] === "popstate") popstateListeners++;
      return realAdd(...(args as Parameters<typeof realAdd>));
    });
  });

  afterEach(() => vi.restoreAllMocks());

  test("does not attach a popstate listener during a server render", async () => {
    // Bug 1: @created used to run window.addEventListener on the server, because
    // @created defaults to env "shared". popstate is now an @onWindow effect, and
    // effects never run server-side.
    await renderToString(<App />);
    expect(popstateListeners).toBe(0);
  });

  test("a second server render does not throw 'A second Router'", async () => {
    // Bug 2: liveRouters++ ran on the server (shared @created) but @destroyed never
    // did (a server render never unmounts), so the counter leaked and the next
    // render threw. The counter is now @created({ env: "client" }), so the server
    // never touches it.
    const first = await renderToString(<App />);
    expect(first).toContain("<span>home</span>");

    await expect(renderToString(<App />)).resolves.toContain("<span>home</span>");
    // And a third, to be sure it is not a one-off reset.
    await expect(renderToString(<App />)).resolves.toContain("<span>home</span>");
  });
});
