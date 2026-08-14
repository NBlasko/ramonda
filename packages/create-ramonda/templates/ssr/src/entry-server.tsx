import { renderPage, renderStatic, ServerRedirect, type StaticRender, type ServerRequestInit } from "@ramonda/core";
import { defineServer, routePlan } from "@ramonda/router/server";
import { App, routes } from "./App";

/** What one request render produced: a page to send, or a redirect to answer with. */
export interface RenderResult {
  html?: string;
  /** The `<title>` this page's `Head` chain resolved to. */
  title?: string;
  /** Its `<meta>` / `<link>`, serialized and ready to drop into the shell's head. */
  head?: string;
  /** What each named portal target collected — a container per entry goes in the shell. */
  portals?: Record<string, string>;
  redirect?: { url: string; status: number };
}

/**
 * SERVER-ONLY route config. It says how each route renders — and it is EXHAUSTIVE, so adding a
 * route to `App.tsx` fails type-checking here until you give it a mode. `@ramonda/router/server`
 * never reaches the client bundle (the client imports `App`, not this file), so loaders and
 * anything they touch stay on the server.
 */
const server = defineServer(routes, {
  "/": { prerender: true }, // static — baked at build
  "/about": { revalidate: 60 }, // ISR — cached, rebaked every 60s
  "/hello/:name": {}, // dynamic — the :name differs per request
});

/** The concrete paths a static build should bake. Used by scripts/prerender.mjs. */
export function staticPaths(): string[] {
  return routePlan(server).static;
}

/** The full plan (static / isr / server / needsData) — the prod server dispatches on it. */
export function plan() {
  return routePlan(server);
}

/**
 * Renders the app for one request (dynamic / SSR). `server.mjs` seeds a DOM at the request URL
 * first; `request` carries the per-request data `requestContext()` will return.
 *
 * A route guard can redirect: the render throws `ServerRedirect`, handed back as a plain result.
 */
export async function render(request?: ServerRequestInit): Promise<RenderResult> {
  try {
    // `renderPage`, not `renderToString`: the latter hands back the body and NOTHING else — no
    // title, no meta, no portal blocks. A page whose title and description never reach the HTML is
    // invisible to exactly the crawlers server rendering exists for.
    const { body, title, head, portals } = await renderPage(<App />, request ? { request } : undefined);
    return { html: body, title, head, portals };
  } catch (err) {
    if (err instanceof ServerRedirect) {
      return { redirect: { url: err.url, status: err.status } };
    }
    throw err;
  }
}

/**
 * Renders one path at BUILD time with the request context poisoned. Returns `{ html }` to bake or
 * `{ blockedBy }` if the route read per-request data (it cannot be static). The caller points the
 * DOM at `path` first (the router reads `window.location`).
 */
export async function prerender(path: string, origin = "http://localhost"): Promise<StaticRender> {
  return renderStatic(<App />, new URL(path, origin));
}
