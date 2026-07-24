import { renderToString } from "@ramonda/core";
import { App } from "./App";

/**
 * Render the app to an HTML string for one request. `server.mjs` seeds a DOM at
 * the request URL before calling this, so anything that reads `window.location`
 * (a router, say) sees the right page.
 */
export async function render(): Promise<string> {
  return renderToString(<App />);
}
