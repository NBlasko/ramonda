import type { QueryClient } from "./QueryClient";

/**
 * Announces a client to whoever is listening — `@ramonda/query/devtools`, when an app has imported
 * it, and nobody otherwise.
 *
 * ## Why an event rather than a registration
 *
 * A registration would mean this file importing the module that holds the panel, which would put
 * that module in the bundle of every application using queries whether or not it ever opens a
 * panel. An event points the other way: the cache announces, and a listener that may not exist
 * keeps whatever list it needs.
 *
 * It is also what core already does — `ramonda:tick`, `ramonda:dev-log` — so a package with
 * something to show has one pattern to copy rather than two.
 *
 * Both calls are behind `__DEV__` at their call site, so a production build carries neither.
 */
export function announceClient(client: QueryClient): void {
  window.dispatchEvent(new CustomEvent("ramonda:query-client", { detail: { client } }));
}

export function announceClientGone(client: QueryClient): void {
  window.dispatchEvent(new CustomEvent("ramonda:query-client-gone", { detail: { client } }));
}
