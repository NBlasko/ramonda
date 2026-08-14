/** Reading what a request carries, and answering with the right content type. */

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

/**
 * The extension, read here rather than with `node:path`.
 *
 * This package argues for linkedom over jsdom because it needs no Node built-in — which is what
 * lets the same render run on Cloudflare Workers, Deno Deploy or Vercel Edge. Importing `node:path`
 * to find the last dot would take that back for three lines of code.
 *
 * The last segment first, so a dot in a DIRECTORY name is not read as an extension:
 * `/v1.2/bundle` has none. A query and a fragment come off before that — a static handler is
 * usually handed a filesystem path, but a URL reaches one often enough that `client.js?v=2`
 * answering `application/octet-stream` would be a live fault. (`node:path`'s `extname` gets that
 * one wrong too, so this is not merely a reimplementation of it.)
 *
 * A leading dot is a NAME, not an extension: `.gitignore` has none, which is `extname`'s rule and
 * the right one.
 */
function extensionOf(path: string): string {
  const bare = path.split(/[?#]/, 1)[0];
  const last = bare.slice(bare.lastIndexOf("/") + 1);
  const dot = last.lastIndexOf(".");
  return dot <= 0 ? "" : last.slice(dot).toLowerCase();
}

export function mimeFor(path: string): string {
  return MIME[extensionOf(path)] ?? "application/octet-stream";
}
