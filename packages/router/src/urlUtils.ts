import type { RouterState } from "./types";

// Pure, framework-agnostic URL <-> state functions. Depend only on the standard
// `URL` / `URLSearchParams` / `window.location` browser APIs.

function parseQueryParams(search: string): Record<string, string> {
  const out: Record<string, string> = {};
  const sp = new URLSearchParams(search);
  sp.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/**
 * The hash, read exactly as the query is: `#a=1&b=2` → `{ a: "1", b: "2" }`.
 *
 * It was split on `#`, one pair per segment, and every pair after the first in a segment was dropped
 * without a word — `#access_token=…&state=…`, the shape an OAuth redirect hands back, lost its state.
 * A bare `#install` is `{ install: "" }`, the name of a section.
 */
function parseHash(hash: string): Record<string, string> {
  return parseQueryParams(hash.startsWith("#") ? hash.slice(1) : hash);
}

/**
 * Blocks dangerous protocols in href attributes (javascript:, data:, vbscript:).
 * Allows relative paths and http(s); everything else falls back to "/".
 * (Manual decodeURIComponent is avoided elsewhere — Snyk flags it, and
 * URLSearchParams handles edge cases better.)
 */
export function sanitizeHref(url: string): string {
  const t = url.trim();
  // Relative "/..." is OK, but reject protocol-relative "//evil.com".
  if (t.startsWith("/") && !t.startsWith("//")) return t;
  if (t.startsWith("http://") || t.startsWith("https://")) return t;
  return "/";
}

/**
 * Strips a trailing slash so `/guide/state/` and `/guide/state` are the same
 * route. Root stays `/`. Without this, a host that adds a trailing slash — a
 * static host serving `dir/index.html`, e.g. Cloudflare Pages 308-redirecting
 * `/x` to `/x/` — leaves the router with a pathname that matches no route, so
 * every direct load or reload falls through to `*` (a 404).
 */
export function normalizePathname(pathname: string): string {
  if (pathname === "/") return "/";

  /**
   * A scan, not `replace(/\/+$/, "")`, and the difference is not style.
   *
   * `\/+$` cannot match when the string does not END in a slash, so the engine retries from every
   * position and backtracks the whole run each time — quadratic. Measured on `"/".repeat(n) + "a"`:
   * 30k took 942ms and 60k took 3.7s. The input here is `window.location.pathname`, so the string
   * comes from whatever URL someone was handed: a crafted link would freeze the tab it was opened
   * in. This loop visits each trailing slash once and stops.
   */
  let end = pathname.length;
  while (end > 0 && pathname.charCodeAt(end - 1) === SLASH) end--;
  return end === 0 ? "/" : pathname.slice(0, end);
}

/** `"/"`, as a char code — see `normalizePathname`. */
const SLASH = 47;

/** Parses the CURRENT browser URL (used at init and on back/forward). */
export function parseUrl(): RouterState {
  return {
    baseUrl: normalizePathname(window.location.pathname),
    queryParams: parseQueryParams(window.location.search),
    hashParams: parseHash(window.location.hash),
  };
}

/** Parses an ARBITRARY URL string (for <Link href> and programmatic navigation). */
export function parseUrlString(url: string): RouterState {
  const parsed = new URL(url, window.location.href); // relative URLs resolve against current
  return {
    baseUrl: normalizePathname(parsed.pathname),
    queryParams: parseQueryParams(parsed.search),
    hashParams: parseHash(parsed.hash),
  };
}

/** Builds a URL string from state (the inverse of parseUrl). */
export function buildUrl(state: RouterState): string {
  let url = state.baseUrl;

  const entries = Object.entries(state.queryParams);
  if (entries.length > 0) {
    const qs = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    url += "?" + qs;
  }

  // As the query is written, except that a key with no value stays bare: `#install` is a section's
  // name, and `#install=` would be a different fragment that names no element.
  const hash = Object.entries(state.hashParams);
  if (hash.length > 0) {
    url +=
      "#" +
      hash
        .map(([k, v]) => (v === "" ? encodeURIComponent(k) : `${encodeURIComponent(k)}=${encodeURIComponent(v)}`))
        .join("&");
  }

  return sanitizeHref(url);
}

/** Whether two flat records hold the same pairs. */
function samePairs(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && a[key] === b[key]);
}

/**
 * The next state, with every part that did not change kept as the object it was.
 *
 * Each part is published to its readers on its own, and a reader re-renders when its part's object
 * changes. A `push` parses the whole URL, so it made a new `{}` for a query and a hash that had not
 * moved, and a component reading only the hash re-rendered on every path change. Comparing here, once,
 * keeps "a component re-renders for the part it reads" true — for a push, an in-place update and
 * back/forward alike.
 */
export function keepUnchanged(prev: RouterState, next: RouterState): RouterState {
  const queryParams = samePairs(prev.queryParams, next.queryParams) ? prev.queryParams : next.queryParams;
  const hashParams = samePairs(prev.hashParams, next.hashParams) ? prev.hashParams : next.hashParams;
  if (queryParams === next.queryParams && hashParams === next.hashParams) return next;
  return { ...next, queryParams, hashParams };
}
