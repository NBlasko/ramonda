/** Reading what a request carries, and answering with the right content type. */

import { extname } from "node:path";

/**
 * A `Cookie` header as the Map a request context reads.
 *
 * Split on the FIRST `=` only: base64 pads with `=`, so splitting on each one truncates exactly the
 * cookies that tend to matter. A pair with no `=` at all is skipped rather than stored as an empty
 * value, since it is not a cookie.
 *
 * A value that is not valid percent-encoding is kept raw. `decodeURIComponent("100%")` throws, and
 * one visitor arriving with a malformed cookie must not take their request down — their other
 * cookies are still readable and the request is still answerable.
 */
export function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;

  for (const pair of header.split(";")) {
    const at = pair.indexOf("=");
    if (at === -1) continue;
    const name = pair.slice(0, at).trim();
    const raw = pair.slice(at + 1).trim();
    try {
      out.set(name, decodeURIComponent(raw));
    } catch {
      out.set(name, raw);
    }
  }
  return out;
}

/**
 * The types a built client actually emits. Anything else is a byte stream rather than a guess —
 * a wrong `Content-Type` is worse than none, since a browser acts on it.
 */
const MIME: Record<string, string> = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".map": "application/json",
  ".txt": "text/plain",
  ".xml": "application/xml",
  ".wasm": "application/wasm",
};

export function mimeFor(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
}
