/**
 * The DOM a server render runs into.
 *
 * Ramonda's server render builds real DOM elements, so Node needs a document. This installs a fresh
 * one, seeded at the request URL — which is also how the router learns which page it is on.
 *
 * **linkedom rather than jsdom.** It needs no Node built-in, which is what lets the same render run
 * on an edge runtime, and it builds a document in 0.018 ms against jsdom's 4.814 — a cost paid on
 * every request. Measured on a 30-row page against a production core build: 0.662 ms per request
 * against 8.530 ms, and end to end on a live dynamic route, 2.97 ms against 9.49 ms.
 *
 * It ships from here because it did not, once: a project's `server.mjs` and its
 * `scripts/prerender.mjs` each had an installer, the server was moved to linkedom, the prerender
 * step was left on jsdom, and a scaffolded build died with `ERR_MODULE_NOT_FOUND` after bundling
 * successfully. Two copies of something this fiddly drift.
 */

import { parseHTML } from "linkedom";

/**
 * `defineProperty`, not assignment: Node ships `navigator` and `location` as getter-only globals,
 * so `globalThis.location = …` throws outright.
 */
function put(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

/** The names a rendering component may reach for. Copied across only when the DOM supplies them. */
const GLOBALS = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "SVGElement",
  "Element",
  "Node",
  "Text",
  "Comment",
  "DocumentFragment",
  "CustomEvent",
  "Event",
  "PopStateEvent",
  "DOMParser",
] as const;

/** What a render is given back, so it can be shut down without knowing what built it. */
export interface DomHandle {
  close(): void;
}

export interface WindowOptions {
  /**
   * Whose `location` and `history` the render sees.
   *
   * `"request"` (the default) builds both from `url`: the DOM has none, and each render is one
   * request at one URL. `"dom"` takes the DOM's own pair, for a DOM that has a working one — jsdom's
   * `pushState` moves its location, which is how a sequential prerender walks a whole site on a
   * single document, changing the URL between pages rather than building one per page.
   */
  navigation?: "request" | "dom";
}

/**
 * A window's globals installed onto `globalThis`, for a DOM this module did not build.
 *
 * Separated from `installDom` so a caller can bring its own: a jsdom, to measure one implementation
 * against the other on the same app, or to prerender a site on one document. Nothing in the
 * framework needs either; diagnosing a difference that shows up under only one implementation, and
 * building a static site, do.
 */
export function installWindow(
  url: string,
  source: Record<string, unknown>,
  { navigation = "request" }: WindowOptions = {},
): void {
  for (const name of GLOBALS) {
    if (source[name] !== undefined) put(name, source[name]);
  }

  /**
   * `location` and `history`, from whichever of the two places the caller named.
   *
   * **The choice is an argument and not a sniff, because sniffing does not work here.** linkedom's
   * window falls through to `globalThis` for anything it does not define, so once a `location` has
   * been installed for one render, the NEXT window reports that same object as its own — including
   * to `hasOwnProperty`. A "use the DOM's if it has one" rule therefore reads as true from the
   * second request onward and pins every later render to the first request's URL. Measured, not
   * reasoned about: it is what broke the test above.
   *
   * `MouseEvent` and `getComputedStyle` are client-only. Nothing dispatches a click or measures a
   * box on a server; they exist so a module that merely NAMES one at import does not throw.
   */
  if (navigation === "dom") {
    put("location", source.location);
    put("history", source.history);
  } else {
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
    // A server has no session history, and an empty one is the honest answer rather than a gap: a
    // router that pushes mid-render is describing navigation nobody can perform, which is pointless
    // rather than fatal. The calls are accepted and discarded so the render does not throw.
    put("history", {
      length: 1,
      state: null,
      pushState() {},
      replaceState() {},
      back() {},
      forward() {},
      go() {},
    });
  }

  put("MouseEvent", source.MouseEvent ?? source.Event ?? Event);
  put("getComputedStyle", source.getComputedStyle ?? (() => ({ getPropertyValue: () => "" })));
  put("requestAnimationFrame", (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0));
  put("cancelAnimationFrame", (id: number) => clearTimeout(id));
}

/**
 * Swaps in a fresh DOM for one render, and answers with a handle to shut it down.
 *
 * `close()` rather than the DOM itself: two implementations do not agree on what a window is, and a
 * caller reaching past this into `dom.window.close()` — jsdom's shape, not linkedom's — is what
 * broke every ISR and dynamic render once already.
 *
 * linkedom has nothing to close, and that is the point of it: `parseHTML` builds plain objects with
 * no timers and no event loop, so dropping the reference is the whole cleanup. The method exists so
 * that a DOM which DOES own one is a change to this file alone.
 */
export function installDom(url: string): DomHandle {
  const dom = parseHTML("<!doctype html><html><head></head><body></body></html>");
  installWindow(url, (dom.window ?? dom) as unknown as Record<string, unknown>);
  return { close: () => {} };
}
