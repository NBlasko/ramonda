import { renderToString, renderStatic, ServerRedirect, type StaticRender, type ServerRequestInit } from "@ramonda/core";
import { defineServer, routePlan } from "@ramonda/router/server";
import { App, routes } from "./App";

/** One request render: a page to send, or a redirect the server answers with. */
export interface RenderResult {
  html?: string;
  redirect?: { url: string; status: number };
}

/**
 * SERVER-ONLY route config (Layer B). Exhaustive — every route in the table must appear, so a
 * new route in App.tsx fails this until it is given a mode. Two static pages are prerendered;
 * the products feed and the per-user page render per request.
 */
const server = defineServer(routes, {
  "/": { prerender: true }, // SSG — baked at build
  "/about": { revalidate: 3 }, // ISR — cached, rebaked every 3s
  "/products": {}, // dynamic — the feed renders per request
  "/users/:id": {}, // dynamic — per-user page
  "/signup": { prerender: true }, // SSG — a form has nothing per-request in it, so it bakes
});

/** The paths a static build should bake (`routePlan.static`), for the prerender script. */
export function staticPaths(): string[] {
  return routePlan(server).static;
}

/** The full plan, if a caller wants the server/isr split too. */
export function plan() {
  return routePlan(server);
}

/**
 * Renders the app for one request URL (dynamic / SSR). The caller installs a DOM shim at the
 * request URL first; `request` carries the per-request data `requestContext()` will return.
 *
 * A route guard may redirect: the render throws `ServerRedirect`, handed back as a plain redirect.
 */
export async function render(request?: ServerRequestInit): Promise<RenderResult> {
  try {
    return { html: await renderToString(<App />, request ? { request } : undefined) };
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
 * DOM at `path` first (the router reads `window.location`); the URL here is the page identity.
 */
export async function prerender(path: string, origin = "http://localhost"): Promise<StaticRender> {
  return renderStatic(<App />, new URL(path, origin));
}
