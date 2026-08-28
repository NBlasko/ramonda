import { beforeEach, describe, expect, test } from "vitest";
import { Component } from "@ramonda/core";
import { render, act, fireEvent } from "@ramonda/testing-library";
import { createRoutes } from "../match";
import { createRouter } from "../createRouter";

/**
 * Typed routing: `createRouter(routes)` binds `<Link href>` / `route()` / `Navigator` to the
 * table's actual paths. The runtime pieces are the same components as the untyped exports;
 * what this file proves is (1) `route()` builds URLs, (2) a typed `<Link>` still navigates,
 * and (3) the TYPES reject a stale href / bad param — the `@ts-expect-error` lines below are
 * validated by `check-types` (an unused expectation there fails the build).
 */

class Home extends Component {
  render() {
    return (
      <main>
        <h1>Home</h1>
      </main>
    );
  }
}
class Profile extends Component {
  render() {
    return (
      <main>
        <h1>Profile</h1>
      </main>
    );
  }
}

const routes = createRoutes({
  "/": <Home />,
  "/about": <Home />,
  "/u/:id": <Profile />,
  "/u/:id/p/:pid": <Profile />,
  "*": <Home />,
});

const { Router, RouteOutlet, Navigator, Link, route } = createRouter(routes);

beforeEach(() => {
  window.history.pushState(null, "", "/");
});

describe("route() builds hrefs", () => {
  test("fills a single param", () => {
    expect(route("/u/:id", { id: "ada" })).toBe("/u/ada");
  });

  test("fills multiple params and url-encodes values", () => {
    expect(route("/u/:id/p/:pid", { id: "a b", pid: "7" })).toBe("/u/a%20b/p/7");
  });

  test("throws on a missing param", () => {
    // @ts-expect-error — intentionally omitting `pid` to test the runtime guard.
    expect(() => route("/u/:id/p/:pid", { id: "a" })).toThrow(/missing the "pid" param/);
  });
});

describe("a typed <Link> still navigates", () => {
  test("static href", () => {
    class WithLink extends Component {
      router = this.use(Router);
      route = this.use(Navigator);
      render() {
        return (
          <div>
            <div>
              <Link href="/about">go</Link>
              <RouteOutlet routes={routes} />
            </div>
          </div>
        );
      }
    }
    const { getByText, container } = render(<WithLink />);
    fireEvent.click(getByText("go"));
    expect(window.location.pathname).toBe("/about");
    expect(container).toBeTruthy();
  });

  test("param href via route()", () => {
    class WithLink extends Component {
      router = this.use(Router);
      render() {
        return (
          <div>
            <div>
              <Link href={route("/u/:id", { id: "42" })}>go</Link>
              <RouteOutlet routes={routes} />
            </div>
          </div>
        );
      }
    }
    const { getByText } = render(<WithLink />);
    fireEvent.click(getByText("go"));
    expect(window.location.pathname).toBe("/u/42");
  });
});

describe("Navigator.push is typed", () => {
  test("a real path pushes; a bad one is a type error", async () => {
    let nav!: InstanceType<typeof Navigator>;
    class Shell extends Component {
      router = this.use(Router);
      n = this.use(Navigator);
      render() {
        nav = this.n;
        return (
          <div>
            <RouteOutlet routes={routes} />
          </div>
        );
      }
    }
    render(<Shell />);
    await act(() => {
      nav.push("/about");
    });
    expect(window.location.pathname).toBe("/about");
  });
});

// ─── type-level: these MUST be errors; check-types validates the expectations ───
function _typeChecks() {
  // valid — a declared static path
  void (<Link href="/about" />);
  // valid — an Href built by route()
  void (<Link href={route("/u/:id", { id: "x" })} />);
  /**
   * A built href takes a query and a fragment, exactly as a written path does.
   *
   * The fragment used to be refused here while `href="/about#top"` was accepted — the two halves of
   * the union were not given the same treatment. An anchor into a section of a parameterised page is
   * the ordinary reason to write one.
   */
  void (<Link href={`${route("/u/:id", { id: "x" })}#top`} />);
  void (<Link href={`${route("/u/:id", { id: "x" })}?tab=2#top`} />);

  // @ts-expect-error — "/nope" is not a declared route
  void (<Link href="/nope" />);

  /**
   * A raw `:param` pattern now COMPILES, and that is a known cost rather than an oversight.
   *
   * `/u/:id` is filled in as `` `/u/${string}` ``, and `":id"` is a string like any other — so the
   * one shape the type cannot tell apart from a real id is the pattern itself. The trade bought
   * `<Link href="/users/42" />` and `` href={`/users/${id}`} `` without `route()`, which is the
   * ordinary case; forgetting to substitute is the rare one, and it misses at runtime into the
   * catch-all rather than going anywhere wrong.
   */
  void (<Link href="/u/:id" />);

  // @ts-expect-error — "pid" is not a param of "/u/:id"
  route("/u/:id", { id: "x", pid: "y" });

  // @ts-expect-error — missing the "id" param
  route("/u/:id", {});

  // @ts-expect-error — "/nope" is not a declared pattern
  route("/nope", {});

  // @ts-expect-error — a static path is not a route() pattern (pass it directly as href)
  route("/about", {});
}
void _typeChecks;

/**
 * `params(pattern)` — the reading side typed from the pattern, the way `route(pattern, …)` has always
 * typed the writing side.
 *
 * Three things, and the third is the one no other router does: the pattern is constrained to the
 * patterns THIS table declares, and it is checked at runtime against the route the outlet actually
 * matched. A type argument nothing verifies is the fault `route()` already refuses on its side.
 */
describe("params(pattern) is typed from the pattern", () => {
  class Named extends Component {
    private nav = this.use(Navigator);
    render() {
      // The type comes OUT of the pattern — no annotation, and `id` is `string`.
      const { id } = this.nav.params("/u/:id");
      return (
        <main>
          <h1>{id}</h1>
        </main>
      );
    }
  }

  class TwoParams extends Component {
    private nav = this.use(Navigator);
    render() {
      const { id, pid } = this.nav.params("/u/:id/p/:pid");
      return (
        <main>
          <h1>{`${id}:${pid}`}</h1>
        </main>
      );
    }
  }

  class App extends Component {
    router = this.use(Router);
    render() {
      return (
        <div>
          <RouteOutlet routes={withNamed} />
        </div>
      );
    }
  }

  const withNamed = createRoutes({
    "/u/:id": <Named />,
    "/u/:id/p/:pid": <TwoParams />,
    "*": <Home />,
  });

  test("reads the param the outlet matched", async () => {
    window.history.pushState(null, "", "/u/ada");
    const mounted = render((<App />) as never);
    try {
      expect(mounted.container.textContent).toBe("ada");
    } finally {
      mounted.unmount();
    }
  });

  test("reads both params of a two-param pattern", async () => {
    window.history.pushState(null, "", "/u/ada/p/7");
    const mounted = render((<App />) as never);
    try {
      expect(mounted.container.textContent).toBe("ada:7");
    } finally {
      mounted.unmount();
    }
  });

  /**
   * The type refuses what the table does not declare. Validated by `check-types` — an unused
   * `@ts-expect-error` fails the build, so these lines cannot rot into silence.
   */
  test("the types refuse a pattern this table does not have", () => {
    const probe = (nav: InstanceType<typeof Navigator>) => {
      // @ts-expect-error — not a pattern in this table
      nav.params("/teams/:teamId");
      // @ts-expect-error — a static path has no params to read
      nav.params("/about");
      // The untyped door is still there, and still typed by what the caller asserts.
      const loose = nav.params<{ id: string }>();
      return loose.id;
    };
    expect(typeof probe).toBe("function");
  });
});

/**
 * The runtime half: a named pattern is a claim about which route this component is on, and an
 * unchecked claim hands back `undefined` typed as `string`.
 */
describe("params(pattern) is checked against the route that matched", () => {
  class Wrong extends Component {
    private nav = this.use(Navigator);
    render() {
      // Claims `:pid`, but the route below only supplies `:id`.
      const { pid } = this.nav.params("/u/:id/p/:pid");
      return (
        <main>
          <h1>{pid}</h1>
        </main>
      );
    }
  }

  class App extends Component {
    router = this.use(Router);
    render() {
      return (
        <div>
          <RouteOutlet routes={onlyId} />
        </div>
      );
    }
  }

  const onlyId = createRoutes({ "/u/:id": <Wrong />, "*": <Home /> });

  test("throws, naming the param and the route it is standing on", () => {
    window.history.pushState(null, "", "/u/ada");
    expect(() => render((<App />) as never)).toThrow(/\[Ramonda Router\] params\("\/u\/:id\/p\/:pid"\)/);
    expect(() => render((<App />) as never)).toThrow(/does not supply it/);
    // The message has to name the route the component IS on, or a reader cannot tell which is wrong.
    expect(() => render((<App />) as never)).toThrow(/"\/u\/:id"/);
  });

  /**
   * NOT an equality check on the key. A component rendered by two patterns that agree on their params
   * names one of them and is right on both — the claim is about the params, not the spelling.
   */
  test("a different pattern with the same param is accepted", () => {
    class Reader extends Component {
      private nav = this.use(Navigator);
      render() {
        return (
          <main>
            <h1>{this.nav.params("/u/:id").id}</h1>
          </main>
        );
      }
    }
    class Two extends Component {
      router = this.use(Router);
      render() {
        return (
          <div>
            <RouteOutlet routes={people} />
          </div>
        );
      }
    }
    // `Reader` names `/u/:id` while being rendered by `/people/:id` — same param, so it holds.
    const people = createRoutes({ "/people/:id": <Reader />, "*": <Home /> });

    window.history.pushState(null, "", "/people/ada");
    const mounted = render((<Two />) as never);
    try {
      expect(mounted.container.textContent).toBe("ada");
    } finally {
      mounted.unmount();
    }
  });
});
