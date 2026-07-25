import { beforeEach, describe, test, expect } from "vitest";
import { Component, Host, create } from "@ramonda/core";
import type { VNode, RamondaNode } from "@ramonda/core";
import { render, act, fireEvent } from "@ramonda/testing-library";
import { Router, RouteOutlet, Navigator } from "../Router";
import { Link } from "../Link";
import { createRoutes } from "../match";
import { scanComponentTree } from "../../../core/src/debug/inspector";

/**
 * The app shell. `Router` is a hook now, so something has to own it — in a real
 * app that is the component wrapping everything; here it is this harness.
 */
@Host("div")
class RouterApp extends Component<{ children?: RamondaNode }> {
  router = this.use(Router);
  render() {
    return this.props.children;
  }
}

/**
 * There used to be a local `mount()` helper here, and an `app.cleanup()` at the
 * end of every test. Those calls were the file's real fragility: a `cleanup()`
 * after the assertions is skipped when one throws, and a surviving Router made
 * every LATER test fail with "a second Router was mounted" — so the one genuine
 * failure hid behind a cascade of unrelated ones.
 *
 * `@ramonda/testing-library` unmounts after each test whether it passed or not,
 * so the calls are gone. The tests that unmount explicitly below do it because
 * unmounting is what they are testing, not to tidy up.
 *
 * `await settle()` is gone for the same kind of reason: it was one microtask
 * turn, so how many you needed depended on how deep the cascade went. `act`
 * drains until nothing is pending.
 */
beforeEach(() => {
  window.history.pushState(null, "", "/");
});

/**
 * The live route's Navigator. Navigation is only reachable from inside the
 * Router's tree now, which is exactly how an app does it — so the routes below
 * publish their hook and the tests drive it.
 */
let route: Navigator;

class Home extends Component {
  hook = this.use(Navigator);
  @create expose() {
    route = this.hook;
  }
  render() {
    return <div id="home">home</div>;
  }
}
class Player extends Component {
  hook = this.use(Navigator);
  @create expose() {
    route = this.hook;
  }
  render() {
    return <div id="player">player {this.hook.params<{ id: string }>().id}</div>;
  }
}
class NotFound extends Component {
  hook = this.use(Navigator);
  @create expose() {
    route = this.hook;
  }
  render() {
    return <div id="nf">not found</div>;
  }
}

const routes = createRoutes({
  "/": (<Home />) as VNode,
  "/players/:id": (<Player />) as VNode,
  "*": (<NotFound />) as VNode,
});

/** The shell every test but a few mounts. */
const app = () =>
  (
    <RouterApp>
      <RouteOutlet routes={routes} />
    </RouterApp>
  ) as VNode;

describe("Router: single instance", () => {
  test("refuses a second Router while one is live", () => {
    render(app());

    expect(() => render(app())).toThrow(/A second Router was mounted/);
  });

  test("a Router can be mounted again once the first unmounts", () => {
    const first = render(app());
    first.unmount();

    // The guard counts live instances; it must not latch.
    const second = render(app());
    expect(second.container.querySelector("#home")).toBeTruthy();
  });
});

describe("Router", () => {
  test("renders the matched route and swaps on navigation", () => {
    const { container } = render(app());

    expect(container.querySelector("#home")).toBeTruthy();

    act(() => route.push("/players/42"));
    const player = container.querySelector("#player");
    expect(player).toBeTruthy();
    expect(player?.textContent).toContain("42");
    expect(container.querySelector("#home")).toBeNull();

    act(() => route.push("/nope"));
    expect(container.querySelector("#nf")).toBeTruthy();
  });

  test("Navigator exposes params from the matched route", () => {
    window.history.pushState(null, "", "/players/7");

    const { container } = render(app());

    expect(container.querySelector("#player")?.textContent).toContain("7");
  });

  test("reads the URL at mount, so it picks up a path set before it", () => {
    window.history.pushState(null, "", "/players/13");

    const { container } = render(app());

    expect(container.querySelector("#player")?.textContent).toContain("13");
  });

  test("re-parses the URL on popstate (back/forward)", () => {
    const { container } = render(app());

    // The browser changes the URL without us, then fires popstate.
    window.history.pushState(null, "", "/players/5");
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(container.querySelector("#player")?.textContent).toContain("5");
  });

  test("stops reacting to popstate once unmounted", () => {
    const { unmount } = render(app());
    // Unmounting IS the subject here, so it happens explicitly.
    unmount();

    // The listener is owned by the instance, so this must not touch anything.
    window.history.pushState(null, "", "/players/5");
    expect(() => window.dispatchEvent(new PopStateEvent("popstate"))).not.toThrow();
  });

  test("each Router instance owns its own store", () => {
    const first = render(app());
    act(() => route.push("/players/1"));
    expect(first.container.querySelector("#player")?.textContent).toContain("1");
    first.unmount();

    // A fresh Router re-reads the URL rather than inheriting the old store.
    window.history.pushState(null, "", "/");
    const second = render(app());
    expect(second.container.querySelector("#home")).toBeTruthy();
  });
});

describe("Router: chrome above the outlet", () => {
  test("a nav bar beside the outlet can navigate, and survives the swap", () => {
    class NavBar extends Component {
      hook = this.use(Navigator);
      render() {
        return (
          <nav>
            <Link href="/players/8">Go</Link>
            <code id="path">{this.hook.pathname}</code>
          </nav>
        );
      }
    }
    class Shell extends Component {
      render() {
        return (
          <RouterApp>
            <div id="shell">
              <NavBar />
              <RouteOutlet routes={routes} />
            </div>
          </RouterApp>
        );
      }
    }

    const { container } = render((<Shell />) as VNode);
    expect(container.querySelector("#home")).toBeTruthy();

    const nav = container.querySelector("nav")!;
    fireEvent.click(container.querySelector("a")!, { button: 0 });

    // The route swapped...
    expect(container.querySelector("#player")?.textContent).toContain("8");
    // ...the nav did not remount...
    expect(container.querySelector("nav")).toBe(nav);
    // ...and it saw the new path.
    expect(container.querySelector("#path")?.textContent).toBe("/players/8");
  });

  test("Navigator methods work when passed as bare callbacks", () => {
    // The playground does `<button onClick={this.route.back}>`. The methods
    // reach navigation through `this.ctx` now, so they must stay bound.
    const { container } = render(app());

    const push = route.push;
    act(() => push("/players/6"));

    expect(container.querySelector("#player")?.textContent).toContain("6");
  });

  test("params still reach the route component under the outlet", () => {
    class NavBar extends Component {
      hook = this.use(Navigator);
      render() {
        return <nav id="nav">{this.hook.pathname}</nav>;
      }
    }
    class Shell extends Component {
      render() {
        return (
          <RouterApp>
            <div>
              <NavBar />
              <RouteOutlet routes={routes} />
            </div>
          </RouterApp>
        );
      }
    }

    const { container } = render((<Shell />) as VNode);
    act(() => route.push("/players/3"));

    expect(container.querySelector("#nav")?.textContent).toBe("/players/3");
    expect(container.querySelector("#player")?.textContent).toContain("3");
  });
});

describe("Navigator: partial-state updates", () => {
  test("updateSearchParams changes only the query, leaving the route in place", () => {
    const { container } = render(app());
    const home = container.querySelector("#home");
    expect(home).toBeTruthy();

    act(() => route.updateSearchParams({ tab: "stats" }));

    // The query is written...
    expect(window.location.search).toBe("?tab=stats");
    expect(route.searchParams).toEqual({ tab: "stats" });
    // ...and the matched route did NOT swap: no re-match on a query-only change,
    // so the very same element is still there (not a rebuilt one).
    expect(container.querySelector("#home")).toBe(home);
  });

  test("the functional form is race-free: two updates in a tick both survive", () => {
    render(app());

    // Two filters changed in the same tick. If the second read stale state it
    // would drop the first's `a=1` and the search would be just `?b=2`.
    act(() => {
      route.updateSearchParams((prev) => ({ ...prev, a: "1" }));
      route.updateSearchParams((prev) => ({ ...prev, b: "2" }));
    });

    expect(window.location.search).toBe("?a=1&b=2");
  });

  test("updateHashTags changes only the hash", () => {
    render(app());

    act(() => route.updateHashTags([{ key: "open", value: "1", level: 0 }]));

    expect(window.location.hash).toBe("#open=1");
    expect(route.pathname).toBe("/");
    expect(window.location.search).toBe("");
  });

  test("push scrolls to the top; a partial update stays put unless asked", () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    try {
      render(app());

      act(() => route.push("/players/1"));
      expect(scrollTo).toHaveBeenCalledTimes(1); // navigation → top

      act(() => route.updateSearchParams({ a: "1" }));
      expect(scrollTo).toHaveBeenCalledTimes(1); // in-place → no scroll

      act(() => route.updateSearchParams({ a: "2" }, { scroll: true }));
      expect(scrollTo).toHaveBeenCalledTimes(2); // opted in
    } finally {
      scrollTo.mockRestore();
    }
  });
});

describe("Link", () => {
  test("renders a real href and intercepts a plain left click", () => {
    const { container } = render(
      (
        <RouterApp>
          <RouteOutlet
            routes={createRoutes({
              "/": (<Link href="/players/9">Go</Link>) as VNode,
              "/players/:id": (<Player />) as VNode,
            })}
          />
        </RouterApp>
      ) as VNode,
    );

    const a = container.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("/players/9");

    // Plain left click → intercepted → routes through updateState.
    fireEvent.click(a, { button: 0 });
    expect(window.location.pathname).toBe("/players/9");
  });

  test("does not intercept external links", () => {
    const { container } = render(
      (
        <RouterApp>
          <RouteOutlet
            routes={createRoutes({
              "/": (<Link href="https://example.com">Ext</Link>) as VNode,
            })}
          />
        </RouterApp>
      ) as VNode,
    );
    const a = container.querySelector("a")!;

    const before = window.location.pathname;
    // Built by hand rather than via fireEvent.click: the assertion is on the
    // EVENT object afterwards, and fireEvent does not hand it back.
    const evt = new MouseEvent("click", {
      bubbles: true,
      button: 0,
      cancelable: true,
    });
    act(() => {
      a.dispatchEvent(evt);
    });

    // Not prevented (the browser would navigate); the store didn't move.
    expect(evt.defaultPrevented).toBe(false);
    expect(window.location.pathname).toBe(before);
  });

  test("a Link with no Router refuses to navigate rather than failing quietly", () => {
    const { container } = render((<Link href="/players/9">Go</Link>) as VNode);
    const a = container.querySelector("a")!;

    // The href still renders — it is a real anchor either way.
    expect(a.getAttribute("href")).toBe("/players/9");

    // The handler throws, but it runs inside an event listener: the exception is
    // reported on window rather than propagating out of dispatchEvent.
    const errors: string[] = [];
    const onError = (e: ErrorEvent) => {
      errors.push(e.error?.message ?? e.message);
      e.preventDefault();
    };
    window.addEventListener("error", onError);

    const before = window.location.pathname;
    try {
      fireEvent.click(a, { button: 0 });
    } finally {
      window.removeEventListener("error", onError);
    }

    expect(errors.join("\n")).toMatch(/no <Router> above this component/);
    expect(window.location.pathname).toBe(before);
  });
});

describe("Router: devtools visibility", () => {
  test("route state shows up on the component tree, with no registerStore", () => {
    const { container } = render(app());
    act(() => route.push("/players/42"));

    // It used to need registerStore because a module global is unreachable from
    // the tree walk. As a plain @state field on a hook, the walk just finds it —
    // now under the owning component's hooks rather than its own state, which
    // reads better anyway: the tree shows a "Router" node that really exists.
    const node = scanComponentTree(container)[0];
    expect(node.name).toBe("RouterApp");

    const routerHook = node.hooks.find((h) => h.name === "Router");
    expect(routerHook).toBeDefined();
    expect(routerHook?.state.routeState).toMatchObject({
      baseUrl: "/players/42",
    });
  });
});
