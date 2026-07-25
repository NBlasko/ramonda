import { renderToString, ServerRedirect } from "@ramonda/core";
import { App } from "./App";

/** One request render: a page to send, or a redirect the server answers with. */
export interface RenderResult {
  html?: string;
  redirect?: { url: string; status: number };
}

/**
 * Renders the app for one request URL.
 *
 * The router reads `window.location`, so seeding it is the server's job: the
 * caller installs a DOM shim pointed at the request URL before this runs. No
 * router API change was needed, and none should be — a router that can be told
 * "you are at /users/42" only through a special server-only entry point would be
 * a second code path to keep honest.
 *
 * A route guard may decide the request belongs elsewhere; the render throws
 * `ServerRedirect`, which we hand back as a plain redirect for the server to turn
 * into a 302.
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
