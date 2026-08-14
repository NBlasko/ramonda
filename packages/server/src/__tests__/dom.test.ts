import { afterEach, describe, expect, test } from "vitest";
import { installDom, installWindow } from "../dom";

/**
 * The DOM a server render runs into.
 *
 * This is the piece that had already drifted into a shipped bug: a project's `server.mjs` and its
 * `scripts/prerender.mjs` each had an installer, one was moved from jsdom to linkedom and the other
 * was not, and the build died at prerender with `ERR_MODULE_NOT_FOUND`. Two copies of something
 * this fiddly drift; one cannot.
 */

const OWNED = ["window", "document", "location", "history", "HTMLElement", "requestAnimationFrame"] as const;

afterEach(() => {
  for (const name of OWNED) delete (globalThis as Record<string, unknown>)[name];
});

describe("installDom", () => {
  test("a render has a document to build elements in", () => {
    installDom("http://localhost:3000/");

    expect(typeof document.createElement).toBe("function");
    const el = document.createElement("div");
    el.textContent = "hi";
    expect(el.outerHTML).toBe("<div>hi</div>");
  });

  test("location is seeded from the URL, which is how the router learns the page", () => {
    installDom("http://localhost:3000/users/42?tab=2#top");

    expect(location.pathname).toBe("/users/42");
    expect(location.search).toBe("?tab=2");
    expect(location.hash).toBe("#top");
    expect(location.origin).toBe("http://localhost:3000");
    expect(String(location)).toBe("http://localhost:3000/users/42?tab=2#top");
  });

  test("history accepts and drops, because a server has no session", () => {
    installDom("http://localhost:3000/");
    // A router that pushes during a server render describes navigation nobody can perform. Throwing
    // would fail the render over something that is merely pointless.
    expect(() => history.pushState(null, "", "/elsewhere")).not.toThrow();
  });

  test("each render lands at its own URL — a server's whole loop", () => {
    // Two things at once, and the second is the one that bites.
    //
    // Node ships `navigator` and `location` as getter-only, so `globalThis.location = …` throws
    // outright; every global here goes in through `defineProperty` for that reason.
    //
    // And linkedom's window falls through to `globalThis` for anything it does not define, so the
    // window built for the SECOND request reports the first request's location as its own — to
    // `hasOwnProperty` as well. Any "keep the DOM's location if it has one" rule reads as true from
    // request two onward and serves every visitor the first URL's page. This is that guard.
    expect(() => installDom("http://localhost:3000/")).not.toThrow();
    expect(location.pathname).toBe("/");

    expect(() => installDom("http://localhost:3000/second")).not.toThrow();
    expect(location.pathname).toBe("/second");

    installDom("http://localhost:3000/third?q=1");
    expect(location.pathname).toBe("/third");
    expect(location.search).toBe("?q=1");
  });

  test("client-only globals are stubbed, so importing a module that names one does not throw", () => {
    installDom("http://localhost:3000/");

    expect(typeof requestAnimationFrame).toBe("function");
    expect(getComputedStyle(document.createElement("div")).getPropertyValue("color")).toBe("");
  });

  test("a DOM that has its own location and history keeps them", () => {
    // jsdom's `pushState` MOVES its location, which is how a sequential prerender walks a site on
    // one DOM — changing the URL between pages instead of building a document per page. Asked for,
    // never guessed: linkedom's window falls through to `globalThis`, so a window built after the
    // first render reports the PREVIOUS render's location as its own and no sniff can tell them
    // apart. See the next test, which is that failure.
    const own = {
      location: { pathname: "/from-the-dom", href: "http://localhost:3000/from-the-dom" },
      history: { pushState: () => "real" },
    };
    installWindow("http://localhost:3000/ignored", own as unknown as Record<string, unknown>, {
      navigation: "dom",
    });

    expect(location.pathname).toBe("/from-the-dom");
    expect(history.pushState(null, "", "/x")).toBe("real");
  });

  test('navigation: "dom" refuses a DOM that has no such pair', () => {
    // The option is the caller asserting the DOM has one. Installing `undefined` instead would fail
    // far from here — in the router, reading a property of nothing, on whichever page came first.
    expect(() => installWindow("http://localhost:3000/", {}, { navigation: "dom" })).toThrow(
      /needs a DOM with its own `location` and `history`/,
    );
  });

  test("the handle closes without needing to know which DOM it was", () => {
    // The caller reached past this into `dom.window.close()` once, which is jsdom's shape and not
    // linkedom's — that is what broke every ISR and dynamic render under linkedom.
    const dom = installDom("http://localhost:3000/");
    expect(() => dom.close()).not.toThrow();
  });
});
