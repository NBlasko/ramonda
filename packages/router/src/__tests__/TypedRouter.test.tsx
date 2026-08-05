import { beforeEach, describe, expect, test } from "vitest";
import { Component, Host } from "@ramonda/core";
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

@Host("main")
class Home extends Component {
  render() {
    return <h1>Home</h1>;
  }
}
@Host("main")
class Profile extends Component {
  render() {
    return <h1>Profile</h1>;
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
    @Host("div")
    class WithLink extends Component {
      router = this.use(Router);
      route = this.use(Navigator);
      render() {
        return (
          <div>
            <Link href="/about">go</Link>
            <RouteOutlet routes={routes} />
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
    @Host("div")
    class WithLink extends Component {
      router = this.use(Router);
      render() {
        return (
          <div>
            <Link href={route("/u/:id", { id: "42" })}>go</Link>
            <RouteOutlet routes={routes} />
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
    @Host("div")
    class Shell extends Component {
      router = this.use(Router);
      n = this.use(Navigator);
      render() {
        nav = this.n;
        return <RouteOutlet routes={routes} />;
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

  // @ts-expect-error — "/nope" is not a declared route
  void (<Link href="/nope" />);

  // @ts-expect-error — a raw :param pattern is not a ready href (needs route())
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
