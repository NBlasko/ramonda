import type { RouterState } from "./types";

// Pure, framework-agnostic URL <-> state functions. Depend only on the standard
// `URL` / `URLSearchParams` / `window.location` browser APIs.

/**
 * The owners, in a container with no prototype. An owner's name comes from the URL, and in a plain
 * object `__proto__` is not a key — writing it replaces the prototype — while `constructor` reads as
 * the `Object` function. Internal: an app is never handed this container, only records from it.
 */
function owners(): Record<string, Record<string, string>> {
  return Object.create(null) as Record<string, Record<string, string>>;
}

/**
 * Writes `key` as an OWN property, which a plain object can hold whatever the name: `__proto__`
 * becomes a key, not a new prototype. What an app is handed — `searchParams`, `hashParams` — stays an
 * ordinary object, so `hasOwnProperty` works on it; the first fix gave those no prototype at all, and
 * a second review found that broke app code no changeset warned about.
 */
function put(out: Record<string, string>, key: string, value: string): void {
  // Only the one name that needs it: `defineProperty` is the slow path, and this runs for every key of
  // every URL parse and every reader's line. Every other name is an ordinary assignment.
  if (key === "__proto__")
    Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
  else out[key] = value;
}

/** `Object.assign`, but through `put` — assignment would run the `__proto__` setter. */
function copyInto(out: Record<string, string>, from: Record<string, string> | undefined): Record<string, string> {
  if (from !== undefined) for (const key of Object.keys(from)) put(out, key, from[key]!);
  return out;
}

function parseQueryParams(search: string): Record<string, string> {
  const out: Record<string, string> = {};
  const sp = new URLSearchParams(search);
  sp.forEach((value, key) => {
    put(out, key, value);
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
  const scopes = owners();
  if (body === "") return scopes;
  const [top = "", ...rest] = body.split("#");
  scopes[""] = parseQueryParams(top);
  for (const segment of rest) {
    const colon = segment.indexOf(":");
    const owner = colon === -1 ? "" : segment.slice(0, colon);
    const pairs = parseQueryParams(colon === -1 ? segment : segment.slice(colon + 1));
    scopes[owner] = copyInto(copyInto({}, scopes[owner]), pairs);
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

/**
 * What a writer under `owner` reads: the top, every owner on the way down to its own, and its own — the
 * same line it writes. The nearer owner wins a key both use.
 *
 * Its line and nothing else. One record of every owner's keys let a child's key shadow its parent's —
 * a page writing its own `nav` made the parent read it, and unmount the page — and let two siblings
 * that use one name read whichever wrote last. Found by a review of this branch.
 */
export function hashParamsFor(scopes: Record<string, Record<string, string>>, owner: string): Record<string, string> {
  const out = copyInto({}, scopes[""]);
  if (owner === "") return out;
  let line = "";
  for (const key of owner.split(".")) {
    line = line === "" ? key : `${line}.${key}`;
    copyInto(out, scopes[line]);
  }
  return out;
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

  const out = owners();
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
    hashScopes: parseHash(window.location.hash),
  };
}

/** Parses an ARBITRARY URL string (for <Link href> and programmatic navigation). */
export function parseUrlString(url: string): RouterState {
  const parsed = new URL(url, window.location.href); // relative URLs resolve against current
  return {
    baseUrl: normalizePathname(parsed.pathname),
    queryParams: parseQueryParams(parsed.search),
    hashScopes: parseHash(parsed.hash),
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
export function samePairs(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && a[key] === b[key]);
}

/**
 * A route state made well-formed, ONCE, where it enters — `keepUnchanged`, which `Router.init` runs the
 * restored state through before anything reads it.
 *
 * What a page restores is JSON: its owners are a plain object, so `constructor` reads as the `Object`
 * function. One the PREVIOUS router version rendered has no `hashScopes` at all, a `hashTags` instead —
 * measured, the client threw and the app did not hydrate until the cache was purged. A second review
 * found that tolerance patched at three readers and missing at three more; here it is one place, and
 * the type is true everywhere after it. A state that is already well-formed comes back as itself, so
 * its owners keep their identity.
 */
export function wellFormed(state: RouterState): RouterState {
  const given = state as Partial<RouterState>;
  const scopes = given.hashScopes;
  if (
    given.queryParams !== undefined &&
    typeof scopes === "object" &&
    scopes !== null &&
    Object.getPrototypeOf(scopes) === null
  )
    return state;
  const fixed = owners();
  if (scopes !== undefined && scopes !== null && typeof scopes === "object") {
    for (const owner of Object.keys(scopes)) fixed[owner] = scopes[owner]!;
  }
  return { ...state, baseUrl: given.baseUrl ?? "/", queryParams: given.queryParams ?? {}, hashScopes: fixed };
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
export function keepUnchanged(given: RouterState, next: RouterState): RouterState {
  const prev = wellFormed(given);
  const queryParams = samePairs(prev.queryParams, next.queryParams) ? prev.queryParams : next.queryParams;
  const prevOwners = Object.keys(prev.hashScopes);
  const hashScopes =
    prevOwners.length === Object.keys(next.hashScopes).length &&
    prevOwners.every((o) => Object.hasOwn(next.hashScopes, o) && samePairs(prev.hashScopes[o]!, next.hashScopes[o]!))
      ? prev.hashScopes
      : next.hashScopes;
  if (queryParams === next.queryParams && hashScopes === next.hashScopes) return next;
  return { ...next, queryParams, hashScopes };
}
