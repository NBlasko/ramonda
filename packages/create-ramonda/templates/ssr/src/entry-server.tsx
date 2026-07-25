import { renderToString, ServerRedirect } from "@ramonda/core";
import { App } from "./App";

/** What one request render produced: a page to send, or a redirect to answer with. */
export interface RenderResult {
  html?: string;
  redirect?: { url: string; status: number };
}

/**
 * Render the app for one request. `server.mjs` seeds a DOM at the request URL
 * before calling this, so anything that reads `window.location` (a router, say)
 * sees the right page.
 *
 * A route guard can decide the request belongs at another URL — for that the
 * render throws `ServerRedirect`, which we turn into a plain result the
 * transport-agnostic `server.mjs` can answer with a 302.
 */
export async function render(): Promise<RenderResult> {
  try {
    return { html: await renderToString(<App />) };
  } catch (err) {
    if (err instanceof ServerRedirect) {
      return { redirect: { url: err.url, status: err.status } };
    }
    throw err;
  }
}
