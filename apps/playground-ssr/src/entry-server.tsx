import { renderToString } from "@ramonda/core";
import { App } from "./App";

/**
 * Renders the app for one request URL.
 *
 * The router reads `window.location`, so seeding it is the server's job: the
 * caller installs a DOM shim pointed at the request URL before this runs. No
 * router API change was needed, and none should be — a router that can be told
 * "you are at /users/42" only through a special server-only entry point would be
 * a second code path to keep honest.
 */
export async function render(): Promise<string> {
  return renderToString(<App />);
}
