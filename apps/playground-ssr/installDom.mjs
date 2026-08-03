/**
 * The DOM a server render runs against, from one place, so both implementations can be measured
 * against the same app.
 *
 * **linkedom is the default.** `RAMONDA_DOM=jsdom` goes back, and it stays because a difference that
 * only appears under one implementation is much easier to diagnose when both are one variable apart.
 *
 * Measured on a 30-row page, production core build:
 *
 * | | Node built-ins | build DOM | render | per request |
 * | --- | --- | --- | --- | --- |
 * | jsdom | 10 | 4.814 ms | 3.716 ms | 8.530 ms |
 * | linkedom | 0 | 0.018 ms | 0.644 ms | 0.662 ms |
 *
 * The build cost dominates, and it is paid PER REQUEST — 4.8 ms of every jsdom request went on
 * constructing a DOM before any rendering started. On the live server, a real dynamic route, the
 * end-to-end figure is 9.49 ms against 2.97 ms per request.
 *
 * linkedom needing no Node built-in is the other half, and the one that decides this: it is what lets
 * a server render run on Cloudflare Workers, Deno Deploy or Vercel Edge, where jsdom cannot go.
 *
 * **The smoke test still loads the client bundle into jsdom**, and that is not an inconsistency —
 * there it is standing in for a BROWSER, hydrating and clicking. This module is only about the DOM
 * the SERVER renders into.
 */

/**
 * defineProperty, not assignment: Node ships `navigator` and `location` as getter-only globals, so
 * `globalThis.navigator = …` throws outright.
 */
const put = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

const GLOBALS = [
  "window",
  "document",
  "navigator",
  "location",
  "history",
  "HTMLElement",
  "SVGElement",
  "Node",
  "Text",
  "CustomEvent",
  "Event",
  "MouseEvent",
  "getComputedStyle",
];

async function jsdomDom(url) {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url });
  for (const name of GLOBALS) put(name, dom.window[name]);
  /**
   * jsdom's `close()` is real work: it stops the window's timers and detaches its event loop, which a
   * long-lived server needs or every request leaves one behind.
   */
  return { close: () => dom.window.close() };
}

async function linkedomDom(url) {
  const { parseHTML } = await import("linkedom");
  const dom = parseHTML("<!doctype html><html><body></body></html>");
  const source = dom.window ?? dom;

  for (const name of GLOBALS) {
    if (source[name] !== undefined) put(name, source[name]);
  }

  /**
   * Three linkedom does not supply, and none of them is a gap in what it renders.
   *
   * `location` — linkedom's `parseHTML` takes no URL, so it has nowhere to get one. The router reads
   * it during a server render, so it is real and it is supplied here from the request's own URL,
   * which is the same thing jsdom is handed. `history` is the same story with a different answer:
   * a server has none, so the calls are accepted and dropped.
   *
   * `MouseEvent` and `getComputedStyle` are client-only: nothing dispatches a click or measures a
   * box on the server. They exist so a component that merely REFERENCES them at module scope does
   * not throw on import — a stub is the honest shape, not an omission.
   */
  const parsed = new URL(url);
  put("location", {
    href: parsed.href,
    origin: parsed.origin,
    protocol: parsed.protocol,
    host: parsed.host,
    hostname: parsed.hostname,
    port: parsed.port,
    pathname: parsed.pathname,
    search: parsed.search,
    hash: parsed.hash,
    toString: () => parsed.href,
  });
  if (globalThis.MouseEvent === undefined) put("MouseEvent", source.Event ?? Event);
  if (globalThis.getComputedStyle === undefined) put("getComputedStyle", () => ({ getPropertyValue: () => "" }));
  /**
   * A server has no session history, and an empty one is the honest answer rather than a gap: a
   * router that pushes during a server render is describing navigation nobody can perform. The
   * calls are accepted and discarded so such a render does not throw.
   */
  if (globalThis.history === undefined) {
    put("history", { length: 1, state: null, pushState() {}, replaceState() {}, back() {}, forward() {}, go() {} });
  }

  /**
   * linkedom has no window to close, and that is the point of it: `parseHTML` builds plain objects
   * with no timers and no event loop of their own, so dropping the reference is the whole cleanup.
   * The method exists so the two implementations are shut down the same way — reaching for jsdom's
   * `dom.window.close()` at the call site is what broke every ISR and dynamic render under linkedom.
   */
  return { close: () => {} };
}

/**
 * Swaps in a fresh DOM for one render, and answers with a handle to shut it down.
 *
 * `close()` rather than the DOM itself: the two implementations do not agree on what a window is, and
 * a caller that reaches past this into one of them only works against that one.
 */
export async function installDom(url) {
  const dom = process.env.RAMONDA_DOM === "jsdom" ? await jsdomDom(url) : await linkedomDom(url);

  put("requestAnimationFrame", (cb) => setTimeout(() => cb(Date.now()), 0));
  put("cancelAnimationFrame", (id) => clearTimeout(id));

  return dom;
}

export const domName = () => (process.env.RAMONDA_DOM === "jsdom" ? "jsdom" : "linkedom");
