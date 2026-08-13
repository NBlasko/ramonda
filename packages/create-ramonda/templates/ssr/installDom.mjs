import { parseHTML } from "linkedom";

/**
 * The one DOM installer, used by BOTH the server and the prerender step.
 *
 * It lives in its own file because it did not, once: the server was moved from jsdom to linkedom and
 * `scripts/prerender.mjs` was left behind on jsdom, which is not installed unless you picked the
 * testing add-on. That project built its bundles and then died on `ERR_MODULE_NOT_FOUND`. Two copies
 * of a thing this fiddly will drift again; one cannot.
 *
 * Ramonda's server render builds real DOM elements, so Node needs a DOM. This
 * installs a fresh one per request, seeded at the request URL — which is also how
 * the router learns which page it is on.
 *
 * `defineProperty`, not assignment: Node ships `navigator`/`location` as
 * getter-only globals, so `globalThis.location = …` would throw.
 *
 * linkedom rather than jsdom: it needs no Node built-in, which is what lets this run on an edge
 * runtime, and it builds a document in 0.018 ms against jsdom's 4.8 — a cost paid on every request.
 */
export function installDom(url) {
  const dom = parseHTML("<!doctype html><html><body></body></html>");
  const source = dom.window ?? dom;
  const put = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

  for (const name of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "SVGElement",
    "Node",
    "Text",
    "CustomEvent",
    "Event",
  ]) {
    if (source[name] !== undefined) put(name, source[name]);
  }

  // linkedom's `parseHTML` takes no URL, so `location` has to be supplied — the router reads it
  // during a server render. A server has no session history, so `history` accepts and drops.
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
  put("history", { length: 1, state: null, pushState() {}, replaceState() {}, back() {}, forward() {}, go() {} });

  // Client-only, stubbed so a module that merely references one at import does not throw.
  put("MouseEvent", source.Event ?? Event);
  put("getComputedStyle", () => ({ getPropertyValue: () => "" }));

  put("requestAnimationFrame", (cb) => setTimeout(() => cb(Date.now()), 0));
  put("cancelAnimationFrame", (id) => clearTimeout(id));

  // A handle rather than the DOM: linkedom builds plain objects with no timers and no event loop, so
  // dropping the reference is the whole cleanup. Swapping in a DOM that DOES own one (jsdom) is then
  // a change to this function alone.
  return { close: () => {} };
}
