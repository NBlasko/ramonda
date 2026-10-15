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
 * The hash, one `#` segment per owner, each read exactly as the query is:
 * `#nav=video#nav:tab=comments&sort=new` → `{ "": { nav: "video" }, nav: { tab: "comments", sort: "new" } }`.
 *
 * The FIRST segment is always the top, `""`, and only a later one names its owner before a `:`. A link
 * from elsewhere to `#section:intro` is therefore a section's name and not an owner. Every key and
 * value is percent-encoded when written, so a `:` or a `#` the router writes is always structure.
 *
 * The keys of one segment are joined with `&`, never one pair per segment: `#access_token=…&state=…`,
 * the shape an OAuth redirect hands back, is one segment with two keys.
 */
function parseHash(hash: string): Record<string, Record<string, string>> {
  const body = hash.startsWith("#") ? hash.slice(1) : hash;
  if (body === "") return {};
  const [top = "", ...rest] = body.split("#");
  const scopes: Record<string, Record<string, string>> = { "": parseQueryParams(top) };
  for (const segment of rest) {
    const colon = segment.indexOf(":");
    const owner = colon === -1 ? "" : segment.slice(0, colon);
    const pairs = parseQueryParams(colon === -1 ? segment : segment.slice(colon + 1));
    scopes[owner] = { ...scopes[owner], ...pairs };
  }
  return scopes;
}

/**
 * A key as it appears in an owner path. Percent-encoded as everywhere in the hash, and `.` as well,
 * which `encodeURIComponent` leaves alone and the path uses between keys.
 */
function ownerKey(key: string): string {
  return encodeURIComponent(key).replace(/\./g, "%2E");
}

/** The owner of what is written under `key` by a writer whose own owner is `owner`. */
export function ownedBy(owner: string, key: string): string {
  return owner === "" ? ownerKey(key) : `${owner}.${ownerKey(key)}`;
}

/** The owners, and every key of them in one record for reading. A deeper owner's key wins a clash. */
export function withHashScopes(
  scopes: Record<string, Record<string, string>>,
): Pick<RouterState, "hashScopes" | "hashParams"> {
  return { hashScopes: scopes, hashParams: Object.assign({}, ...orderedOwners(scopes).map((o) => scopes[o])) };
}

/** The top first, then each owner after the one that owns it — the order a URL is written in. */
function orderedOwners(scopes: Record<string, Record<string, string>>): string[] {
  const depth = (owner: string) => (owner === "" ? 0 : owner.split(".").length);
  return Object.keys(scopes).sort((a, b) => depth(a) - depth(b));
}

/**
 * The owners after one of them writes its keys.
 *
 * Every key whose value CHANGED takes with it everything it owns, at every depth: a child's keys belong
 * to what the key above it showed, and a different value there shows something else. A key that did
 * not change keeps what it owns — a parent re-asserting `nav` does not wipe the page under it, and a
 * change to `panel` does not touch what `nav` owns. That last one is why ownership is by KEY and not by
 * depth: by depth alone, two pages side by side were one level, and either one cleared the other.
 */
export function writeHashScope(
  scopes: Record<string, Record<string, string>>,
  owner: string,
  next: Record<string, string>,
): Record<string, Record<string, string>> {
  const current = scopes[owner] ?? {};
  if (samePairs(current, next)) return scopes;

  const changed = new Set([...Object.keys(current), ...Object.keys(next)]);
  for (const key of changed) if (Object.hasOwn(current, key) && current[key] === next[key]) changed.delete(key);
  const cleared = [...changed].map((key) => ownedBy(owner, key));
  const isCleared = (o: string) => cleared.some((c) => o === c || o.startsWith(`${c}.`));

  const out: Record<string, Record<string, string>> = {};
  for (const [o, pairs] of Object.entries(scopes)) if (o !== owner && !isCleared(o)) out[o] = pairs;
  out[owner] = next;
  return out;
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
    ...withHashScopes(parseHash(window.location.hash)),
  };
}

/** Parses an ARBITRARY URL string (for <Link href> and programmatic navigation). */
export function parseUrlString(url: string): RouterState {
  const parsed = new URL(url, window.location.href); // relative URLs resolve against current
  return {
    baseUrl: normalizePathname(parsed.pathname),
    queryParams: parseQueryParams(parsed.search),
    ...withHashScopes(parseHash(parsed.hash)),
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

  // Each owner's keys are written as the query is, except that a key with no value stays bare:
  // `#install` is a section's name, and `#install=` would be a different fragment that names no element.
  // The top is always the first segment, empty when it has no keys and something below it does; an
  // owner with no keys is not written.
  const segment = (pairs: Record<string, string>) =>
    Object.entries(pairs)
      .map(([k, v]) => (v === "" ? encodeURIComponent(k) : `${encodeURIComponent(k)}=${encodeURIComponent(v)}`))
      .join("&");
  const below = orderedOwners(state.hashScopes).filter((o) => o !== "" && Object.keys(state.hashScopes[o]!).length > 0);
  const top = segment(state.hashScopes[""] ?? {});
  if (top !== "" || below.length > 0) {
    url += "#" + [top, ...below.map((o) => `${o}:${segment(state.hashScopes[o]!)}`)].join("#");
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
  const prevOwners = Object.keys(prev.hashScopes);
  const hashScopes =
    prevOwners.length === Object.keys(next.hashScopes).length &&
    prevOwners.every((o) => Object.hasOwn(next.hashScopes, o) && samePairs(prev.hashScopes[o]!, next.hashScopes[o]!))
      ? prev.hashScopes
      : next.hashScopes;
  if (queryParams === next.queryParams && hashParams === next.hashParams && hashScopes === next.hashScopes) return next;
  return { ...next, queryParams, hashParams, hashScopes };
}
