import { beforeEach, describe, test, expect } from "vitest";
import { createNavigator, detachedNavigator } from "../store";
import { parseUrl } from "../urlUtils";
import type { RouterState } from "../types";

/**
 * In an app the state behind this comes from the <Router>'s `@state` field. The
 * navigator only asks for read/write, so here a plain closure stands in — no
 * signal, no module global, nothing to reset between tests.
 */
function makeRouter() {
  let value: RouterState = parseUrl();
  const nav = createNavigator({
    read: () => value,
    write: (next) => {
      value = next;
    },
  });
  return { read: () => value, nav };
}

beforeEach(() => {
  window.history.pushState(null, "", "/");
});

describe("navigator: race-free updateState", () => {
  test("two sequential updaters serialize over the freshest state", () => {
    const { read, nav } = makeRouter();

    // In a React closure the 2nd would read stale state and drop `a`.
    nav.updateState((p) => ({
      ...p,
      queryParams: { ...p.queryParams, a: "1" },
    }));
    nav.updateState((p) => ({
      ...p,
      queryParams: { ...p.queryParams, b: "2" },
    }));

    expect(read().queryParams).toEqual({ a: "1", b: "2" });
    expect(window.location.search).toBe("?a=1&b=2");
  });

  test("updateState syncs the URL from state", () => {
    const { nav } = makeRouter();

    nav.updateState(() => ({
      baseUrl: "/players/7",
      queryParams: { x: "1" },
      hashTags: [],
    }));

    expect(window.location.pathname).toBe("/players/7");
    expect(window.location.search).toBe("?x=1");
  });

  test("two routers keep separate state", () => {
    // The whole reason the module global had to go: concurrent server renders
    // must not share route state.
    const a = makeRouter();
    const b = makeRouter();

    a.nav.updateState(() => ({
      baseUrl: "/a",
      queryParams: {},
      hashTags: [],
    }));

    expect(a.read().baseUrl).toBe("/a");
    expect(b.read().baseUrl).toBe("/");
  });
});

describe("navigator: imperative navigation", () => {
  test("push parses href into state and updates the URL", () => {
    const { read, nav } = makeRouter();

    nav.push("/players/42?tab=info");

    expect(read().baseUrl).toBe("/players/42");
    expect(read().queryParams).toEqual({ tab: "info" });
    expect(window.location.pathname).toBe("/players/42");
  });

  test("replace updates state without leaving the previous baseUrl behind", () => {
    const { read, nav } = makeRouter();

    nav.replace("/a");
    expect(read().baseUrl).toBe("/a");
    nav.replace("/b");
    expect(read().baseUrl).toBe("/b");
  });
});

describe("navigator: detached", () => {
  test("refuses to navigate with no Router, instead of failing quietly", () => {
    expect(() => detachedNavigator.push("/x")).toThrow(/no <Router> above this component/);
    expect(() => detachedNavigator.updateState((p) => p)).toThrow(/no <Router> above this component/);
  });
});
