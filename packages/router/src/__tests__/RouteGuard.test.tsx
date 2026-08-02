import { beforeEach, describe, expect, test } from "vitest";
import { Component, Host, bootstrap, mount, unmount } from "@ramonda/core";
import type { RamondaNode, VNode } from "@ramonda/core";
import { Router, RouteOutlet, Navigator } from "../Router";
import { createRoutes } from "../match";

/**
 * What a route guard actually does in the BROWSER — which is not what the docs used to say.
 *
 * On the server a guard is real protection: the render throws `ServerRedirect` and nothing is
 * sent (see ServerRedirect.test.tsx). In the browser it is navigation, and navigation is
 * batched — so the guarded component is built, its `render()` runs, and the redirect is applied
 * afterwards. A page that assumed "the guard stopped me" would read data it does not have and
 * throw instead of redirecting.
 *
 * These tests exist so the documented rule cannot quietly stop being true. See
 * apps/docs/content/routing/server.md.
 */

@Host("div")
class RouterApp extends Component<{ children?: RamondaNode }> {
  router = this.use(Router);
  render() {
    return this.props.children;
  }
}

@Host("div")
class Login extends Component {
  render() {
    return <p>login</p>;
  }
}

let signedIn = false;
let renders = 0;
let sideEffects = 0;

/** The shape the docs warn against: render() trusts the guard. */
@Host("div")
class Trusting extends Component {
  private route = this.use(Navigator);
  @mount guard() {
    if (!signedIn) this.route.replace("/login");
  }
  @mount load() {
    sideEffects++;
  }
  render() {
    renders++;
    return <h1>SECRET</h1>;
  }
}

/** The shape the docs recommend: render() answers for itself. */
@Host("div")
class Careful extends Component {
  private route = this.use(Navigator);
  @mount guard() {
    if (!signedIn) this.route.replace("/login");
  }
  render() {
    renders++;
    if (!signedIn) return null;
    return <h1>SECRET</h1>;
  }
}

/** A check that waits on the network, which is the one that really flickers. */
@Host("div")
class AwaitsTheNetwork extends Component {
  private route = this.use(Navigator);
  @mount async guard() {
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (!signedIn) this.route.replace("/login");
  }
  render() {
    return <h1>SECRET</h1>;
  }
}

function mountAt(view: VNode) {
  const routes = createRoutes({ "/account": view, "/login": <Login /> });
  const container = document.createElement("div");
  document.body.appendChild(container);
  bootstrap(
    (
      <RouterApp>
        <RouteOutlet routes={routes} />
      </RouterApp>
    ) as never,
    container,
  );
  return {
    container,
    stop: () => {
      unmount(container);
      container.remove();
    },
  };
}

beforeEach(() => {
  signedIn = false;
  renders = 0;
  sideEffects = 0;
  window.history.pushState(null, "", "/account");
});

describe("a guard does not stop the render it guards", () => {
  test("render() runs, and so does every other @mount on the component", async () => {
    const app = mountAt((<Trusting />) as VNode);
    try {
      // Both already happened by the time bootstrap returned. This is why `render()` has to be
      // safe for a visitor being turned away, and why a fetch beside the guard fires for them.
      expect(renders).toBe(1);
      expect(sideEffects).toBe(1);
      expect(app.container.textContent).toBe("SECRET");
    } finally {
      app.stop();
    }
  });

  test("a render that answers for itself builds nothing protected", () => {
    const app = mountAt((<Careful />) as VNode);
    try {
      expect(renders).toBe(1);
      // The render ran and produced nothing — which is the difference that matters.
      expect(app.container.textContent).toBe("");
    } finally {
      app.stop();
    }
  });
});

describe("when the redirect lands", () => {
  test("a synchronous check resolves within a microtask, so nothing is painted", async () => {
    const app = mountAt((<Trusting />) as VNode);
    try {
      // Updates batch through queueMicrotask, and the browser paints AFTER microtasks — so one
      // microtask is the whole window in which the protected markup exists.
      await Promise.resolve();
      expect(app.container.textContent).toBe("login");
      expect(window.location.pathname).toBe("/login");
    } finally {
      app.stop();
    }
  });

  test("a check that awaits the network is still showing the page a task later", async () => {
    const app = mountAt((<AwaitsTheNetwork />) as VNode);
    try {
      // A macrotask boundary is a paint boundary: the await released the frame, so this is what
      // the visitor sees. THIS is the flicker, and no amount of batching removes it — the fix is
      // to know the answer before rendering.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(app.container.textContent).toBe("SECRET");

      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(app.container.textContent).toBe("login");
    } finally {
      app.stop();
    }
  });
});
