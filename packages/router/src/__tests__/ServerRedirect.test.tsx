import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Component, Host, mounted, renderToString, ServerRedirect } from "@ramonda/core";
import type { RamondaNode } from "@ramonda/core";
import { render } from "@ramonda/testing-library";
import { Router, RouteOutlet, Navigator } from "../Router";
import { createRoutes } from "../match";

/**
 * A route guard on the server. The interesting case the redesign was for: a
 * `@mounted` (which runs on the server) decides the visitor is at the wrong URL and
 * navigates. On the client that is an ordinary history change; on the server there
 * is no history to change and no client to re-render for, so the render must instead
 * signal "send this request to /login" — a thrown `ServerRedirect` the transport
 * turns into a 302. Without it the server would hand back a page for the wrong URL,
 * which then snaps back the moment the client reads `window.location`.
 */

// Flipped per test to stand in for an auth check.
let authed = true;

@Host("main")
class Protected extends Component {
  private route = this.use(Navigator);
  @mounted guard() {
    if (!authed) this.route.replace("/login");
  }
  render() {
    return <h1>Secret</h1>;
  }
}

@Host("main")
class Login extends Component {
  render() {
    return <h1>Please log in</h1>;
  }
}

const routes = createRoutes({
  "/": <Protected />,
  "/login": <Login />,
  "*": <Login />,
});

@Host("div")
class App extends Component<{ children?: RamondaNode }> {
  router = this.use(Router);
  render() {
    return <RouteOutlet routes={routes} />;
  }
}

beforeEach(() => {
  authed = true;
  window.history.pushState(null, "", "/");
});
afterEach(() => {
  authed = true;
});

describe("server-side route-guard redirect", () => {
  test("a guard navigation on the server throws ServerRedirect to the target", async () => {
    authed = false;
    window.history.pushState(null, "", "/");

    const err = await renderToString(<App />).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ServerRedirect);
    expect((err as ServerRedirect).url).toBe("/login");
    expect((err as ServerRedirect).status).toBe(302);
  });

  test("no guard fired → the page renders normally, no throw", async () => {
    authed = true;
    window.history.pushState(null, "", "/");

    const html = await renderToString(<App />);

    expect(html).toContain("<h1>Secret</h1>");
    expect(html).not.toContain("Please log in");
  });

  test("first redirect wins — a second one in the same render is ignored", async () => {
    @Host("main")
    class DoubleGuard extends Component {
      private route = this.use(Navigator);
      @mounted guard() {
        this.route.replace("/first");
        this.route.replace("/second");
      }
      render() {
        return <h1>x</h1>;
      }
    }

    const doubleRoutes = createRoutes({
      "/": <DoubleGuard />,
      "*": <Login />,
    });

    @Host("div")
    class DoubleApp extends Component {
      router = this.use(Router);
      render() {
        return <RouteOutlet routes={doubleRoutes} />;
      }
    }

    window.history.pushState(null, "", "/");
    const err = await renderToString(<DoubleApp />).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ServerRedirect);
    expect((err as ServerRedirect).url).toBe("/first");
  });
});

describe("the same guard on the client", () => {
  test("navigates normally instead of throwing", () => {
    authed = false;
    window.history.pushState(null, "", "/");

    // render() mounts on the client and drains lifecycle; the guard's replace()
    // takes the ordinary history path, so we end up on /login with no throw.
    const { container } = render(<App />);

    expect(window.location.pathname).toBe("/login");
    expect(container.textContent).toContain("Please log in");
  });
});
