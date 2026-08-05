import { beforeEach, describe, expect, test, vi } from "vitest";
import { Component, Host, bootstrap, createContext, mount, state, unmount, updated } from "@ramonda/core";
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

/** The live app's Navigator, so a test can click through the way a visitor does. */
let liveNav: Navigator | undefined;

@Host("div")
class RouterApp extends Component<{ children?: RamondaNode }> {
  router = this.use(Router);
  private route = this.use(Navigator);
  render() {
    liveNav = this.route;
    return this.props.children;
  }
}

@Host("div")
class Home extends Component {
  render() {
    return <p>home</p>;
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

/**
 * A check that waits on the network, which is the one that really flickers.
 *
 * The wait is a gate the TEST opens, not a timer. It was `setTimeout(…, 5)`, and that made the
 * test race two unrelated timers: the assertion "the page is still up" only held while the
 * guard's 5ms had not elapsed, and on a loaded CI runner the test's own `setTimeout(0)` was
 * delayed past it — so the redirect had already landed and the test failed for a reason that had
 * nothing to do with the framework. A pending promise is pending however slow the machine is.
 */
let releaseCheck: () => void = () => {};
let checkInFlight: Promise<void>;

@Host("div")
class AwaitsTheNetwork extends Component {
  private route = this.use(Navigator);
  @mount async guard() {
    await checkInFlight;
    if (!signedIn) this.route.replace("/login");
  }
  render() {
    return <h1>SECRET</h1>;
  }
}

function mountAt(view: VNode, start = "/account") {
  window.history.pushState(null, "", start);
  const routes = createRoutes({ "/": <Home />, "/account": view, "/login": <Login /> });
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
  liveNav = undefined;
  checkInFlight = new Promise<void>((resolve) => {
    releaseCheck = resolve;
  });
  window.history.pushState(null, "", "/account");
});

describe("a guard does not stop the render it guards", () => {
  test("render() runs, and so does every other @mount on the component", async () => {
    const app = mountAt(<Trusting />);
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
    const app = mountAt(<Careful />);
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
    const app = mountAt(<Trusting />);
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

  test("a LIVE navigation never shows the protected page at all", async () => {
    /**
     * The case that looks worst on paper: the app is already running, someone clicks through to a
     * guarded route, and `@mount` cannot possibly run before `render()`. So surely the data is on
     * screen first?
     *
     * No — and the reason is `processTask`, which is one drain, not one build:
     * `do { drainBuilds(); flushPostCommit(); flushUpdated(); } while (taskQueue.length > 0)`.
     * The guarded component is built, `flushPostCommit` runs its `@mount`, the redirect it asks
     * for lands back in the queue, and the `while` picks it up in the SAME call. Both renders and
     * both commits happen inside one microtask, so the protected markup is not merely unpainted —
     * it is never observable from outside at all.
     */
    const app = mountAt(<Trusting />, "/");
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(app.container.textContent).toBe("home");

      liveNav!.push("/account");
      // Queued, not synchronous: nothing has rebuilt yet.
      expect(app.container.textContent).toBe("home");

      await Promise.resolve();
      // "SECRET" was built and committed between those two lines and is already gone.
      expect(app.container.textContent).toBe("login");
      expect(renders).toBe(1);
    } finally {
      app.stop();
    }
  });

  test("a check that awaits the network is still showing the page a task later", async () => {
    const app = mountAt(<AwaitsTheNetwork />);
    try {
      // A macrotask boundary is a paint boundary: the await released the frame, so this is what
      // the visitor sees. THIS is the flicker, and no amount of batching removes it — the fix is
      // to know the answer before rendering.
      //
      // Deterministic because the check is a promise only this test resolves: however slow the
      // machine, it has not answered yet, so the page must still be up.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(app.container.textContent).toBe("SECRET");

      releaseCheck();
      await vi.waitFor(() => expect(app.container.textContent).toBe("login"));
    } finally {
      app.stop();
    }
  });
});

/**
 * The third state. A real app spends its first moments not knowing whether anyone is signed in,
 * and "not yet" is not "no" — redirecting on it would throw out every visitor during startup.
 *
 * So the page renders a pending state and waits. Which raises the question these two tests answer:
 * when the answer finally arrives, what makes the guard decide again?
 */
describe("when the answer arrives after the page is already up", () => {
  type Status = "pending" | "in" | "out";

  const [SessionProvider, SessionConsumer] = createContext<{ status: Status }>(
    { status: "pending" },
    { label: "Session" },
  );

  let shell: SessionShell | undefined;
  let decisions = 0;

  @Host("div")
  class SessionShell extends Component<{ children?: RamondaNode }> {
    router = this.use(Router);
    @state status: Status = "pending";
    session = this.use(SessionProvider, () => ({ status: this.status }));
    render() {
      shell = this;
      return this.props.children;
    }
  }

  /** Guard in @mount only. */
  @Host("div")
  class OnlyOnMount extends Component {
    private route = this.use(Navigator);
    private session = this.use(SessionConsumer);
    @mount guard() {
      decisions++;
      if (this.session.status === "out") this.route.replace("/login");
    }
    render() {
      if (this.session.status === "pending") return <p>checking</p>;
      if (this.session.status === "out") return null;
      return <h1>SECRET</h1>;
    }
  }

  /** The same method, on both lifecycles. */
  @Host("div")
  class OnEveryCommit extends Component {
    private route = this.use(Navigator);
    private session = this.use(SessionConsumer);
    @mount
    @updated
    guard() {
      decisions++;
      if (this.session.status === "out") this.route.replace("/login");
    }
    render() {
      if (this.session.status === "pending") return <p>checking</p>;
      if (this.session.status === "out") return null;
      return <h1>SECRET</h1>;
    }
  }

  async function settleWith(view: VNode) {
    const routes = createRoutes({ "/account": view, "/login": <Login /> });
    const container = document.createElement("div");
    document.body.appendChild(container);
    bootstrap(
      (
        <SessionShell>
          <RouteOutlet routes={routes} />
        </SessionShell>
      ) as never,
      container,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    return {
      container,
      arrive: async (status: Status) => {
        shell!.status = status;
        await new Promise((resolve) => setTimeout(resolve, 0));
      },
      stop: () => {
        unmount(container);
        container.remove();
      },
    };
  }

  beforeEach(() => {
    shell = undefined;
    decisions = 0;
  });

  test("@mount alone strands the visitor: no page, no redirect", async () => {
    const app = await settleWith(<OnlyOnMount />);
    try {
      expect(app.container.textContent).toBe("checking");
      expect(decisions).toBe(1);

      await app.arrive("out");

      // `render()` did its job — nothing protected was built. But @mount does not run again, so
      // nothing ever navigated: a blank page, still sitting on the protected URL. This is the
      // failure mode that looks like it works, because the secret is not on screen.
      expect(app.container.textContent).toBe("");
      expect(window.location.pathname).toBe("/account");
      expect(decisions).toBe(1);
    } finally {
      app.stop();
    }
  });

  test("@mount + @updated decides again, and sends them away", async () => {
    const app = await settleWith(<OnEveryCommit />);
    try {
      expect(app.container.textContent).toBe("checking");
      expect(decisions).toBe(1); // the @mount run

      await app.arrive("out");

      // Reading a context key subscribes this component to it, so the change re-renders — and
      // @updated runs after every commit that is not the first, which is exactly the one the
      // late answer produced.
      expect(app.container.textContent).toBe("login");
      expect(window.location.pathname).toBe("/login");
      expect(decisions).toBe(2);
    } finally {
      app.stop();
    }
  });
});
