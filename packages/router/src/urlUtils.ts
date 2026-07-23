import type { HashTag, RouterState } from "./types";

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

function parseHash(hash: string): HashTag[] {
  const tags: HashTag[] = [];
  if (!hash) return tags;

  // "#a=1#b=2" → ["a=1", "b=2"]
  const parts = hash.split("#").filter(Boolean);
  parts.forEach((part, index) => {
    // URLSearchParams is used deliberately: it decodes `+`→space and `%xx` correctly.
    const params = new URLSearchParams(part);
    const first = params.entries().next().value;
    if (first) tags.push({ key: first[0], value: first[1], level: index });
    else tags.push({ key: part, value: "", level: index });
  });
  return tags;
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

/** Parses the CURRENT browser URL (used at init and on back/forward). */
export function parseUrl(): RouterState {
  return {
    baseUrl: window.location.pathname,
    queryParams: parseQueryParams(window.location.search),
    hashTags: parseHash(window.location.hash),
  };
}

/** Parses an ARBITRARY URL string (for <Link href> and programmatic navigation). */
export function parseUrlString(url: string): RouterState {
  const parsed = new URL(url, window.location.href); // relative URLs resolve against current
  return {
    baseUrl: parsed.pathname,
    queryParams: parseQueryParams(parsed.search),
    hashTags: parseHash(parsed.hash),
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

  // Sort by level so URL order is deterministic regardless of insertion order.
  const sorted = [...state.hashTags].sort((a, b) => a.level - b.level);
  for (const ht of sorted) {
    url += ht.value ? `#${ht.key}=${ht.value}` : `#${ht.key}`;
  }

  return sanitizeHref(url);
}
