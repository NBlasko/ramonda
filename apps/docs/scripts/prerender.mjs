import { mkdirSync, writeFileSync, cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";

/**
 * Writes the whole site to `dist/` as static HTML.
 *
 * ## Why a DOM is installed before the server bundle is imported
 *
 * `renderToString` builds real elements and reads `innerHTML` back, and the
 * router reads `window.location`. Neither is a shim to be replaced later: the
 * server render is the same code as the client render, which is the only reason
 * hydration can adopt what it produces. So Node gets a DOM.
 *
 * ## One DOM, not one per page
 *
 * `apps/playground-ssr/server.mjs` builds a fresh JSDOM per REQUEST, because
 * concurrent requests would otherwise share one `window.location`. A build loop
 * is sequential, so it does not need that — the URL is changed with `pushState`
 * between pages and each one comes out correct. Measured in
 * `packages/router/src/__tests__/Prerender.test.tsx`, including that two
 * consecutive builds are byte-for-byte identical.
 *
 * ## Why it imports a BUILT bundle
 *
 * Node cannot parse TC39 decorators, so `@Host("div") class …` is a syntax error
 * in source. The server bundle is transpiled by esbuild first; this only ever
 * loads the output.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dist = join(root, "dist");
const serverBundle = join(root, ".build", "entry-server.js");

function installDom(url) {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    url,
  });

  // defineProperty, not assignment: Node ships `navigator` and `location` as
  // getter-only globals, so `globalThis.navigator = ...` throws outright.
  const put = (name, value) =>
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
    });

  for (const name of [
    "window",
    "document",
    "navigator",
    "location",
    "history",
    "HTMLElement",
    "SVGElement",
    "Node",
    "Text",
    "DOMParser",
    "CustomEvent",
    "Event",
    "MouseEvent",
    "PopStateEvent",
    "getComputedStyle",
  ]) {
    put(name, dom.window[name]);
  }
  put("requestAnimationFrame", (cb) => setTimeout(() => cb(Date.now()), 0));
  put("cancelAnimationFrame", (id) => clearTimeout(id));
  return dom;
}

/**
 * `/` → `dist/index.html`; `/guide/installation` → `dist/guide/installation.html`.
 *
 * FLAT `.html` files, not `dir/index.html`. A static host serves a flat file at
 * its exact path (`/guide/installation`), but serves a directory only with a
 * trailing slash — so `dir/index.html` makes Cloudflare Pages 308-redirect
 * `/guide/installation` → `/guide/installation/`, which is the ugly trailing
 * slash. Flat files give clean, slash-free URLs with no redirect.
 */
function outputPath(routePath) {
  if (routePath === "/") return join(dist, "index.html");
  return join(dist, routePath.replace(/^\//, "") + ".html");
}

if (!existsSync(serverBundle)) {
  throw new Error(
    `[docs] ${serverBundle} is missing. Run \`npm run build:server\` first — ` +
      `this script loads transpiled output because Node cannot parse decorators.`,
  );
}

installDom("http://localhost/");

const { paths, renderOne } = await import(pathToFileURL(serverBundle).href);

const routePaths = paths();
let bytes = 0;

for (const routePath of routePaths) {
  const html = await renderOne(routePath);
  const file = outputPath(routePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
  bytes += Buffer.byteLength(html);
  console.log(`[docs] ${routePath.padEnd(24)} → ${file.slice(root.length + 1)}  ${Buffer.byteLength(html)} B`);
}

// A physical not-found page. Static hosts serve `/404.html` for any URL that maps
// to no file, and the app's `*` route already renders the not-found state — so
// prerendering one unmatched path gives a 404 that looks like the rest of the
// site and hydrates into a working app. The not-found body carries no path, so
// the same file is correct whatever URL the host serves it at, and the client
// re-derives the real one from `window.location` on hydration.
const notFoundHtml = await renderOne("/404");
writeFileSync(join(dist, "404.html"), notFoundHtml);
bytes += Buffer.byteLength(notFoundHtml);
console.log(`[docs] ${"(not found)".padEnd(24)} → dist/404.html  ${Buffer.byteLength(notFoundHtml)} B`);

/**
 * Redirects for pages that have moved, as a Cloudflare Pages `_redirects` file.
 *
 * `/concepts/effects` became `/concepts/subscriptions`, and the old URL started returning 404
 * on the deployed site the moment the rename shipped — measured, not assumed. A renamed page is a broken link for everyone who saved the old one, and for
 * every search index that has it.
 *
 * A file rather than a route: the host answers with a 301 before the app is ever loaded, so
 * the redirect works for a crawler and costs no JavaScript. `301` because these are
 * permanent — the old paths are not coming back.
 */
const redirects = [["/concepts/effects", "/concepts/subscriptions", 301]];

writeFileSync(join(dist, "_redirects"), `${redirects.map(([from, to, code]) => `${from} ${to} ${code}`).join("\n")}\n`);
console.log(`[docs] ${"(redirects)".padEnd(24)} → dist/_redirects  ${redirects.length} rule(s)`);

// Static assets. `public/` is copied verbatim so a favicon or a stylesheet needs
// no build entry of its own.
const publicDir = join(root, "public");
if (existsSync(publicDir)) cpSync(publicDir, dist, { recursive: true });

console.log(`[docs] ${routePaths.length} page(s) + 404, ${bytes} B of HTML → dist/`);
