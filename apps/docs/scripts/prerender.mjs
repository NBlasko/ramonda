import { mkdirSync, writeFileSync, cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installDom } from "@ramonda/server";

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
 * ## One DOM per page, the same as a server does per request
 *
 * This used to build its own jsdom and walk the whole site on that ONE document,
 * moving between pages with `pushState` — which needed `navigation: "dom"` from
 * `installWindow`, a mode that exists because jsdom's `location` follows a
 * `pushState` and linkedom has no `location` at all.
 *
 * The reason for the single document was cost, and the cost is gone. A jsdom
 * document takes 4.8 ms to build, so 77 of them is a third of a second;
 * `installDom` uses linkedom, at 0.018 ms, which is 1.4 ms for the whole site.
 * What that buys is the ordinary arrangement instead of a special one: the URL
 * is where the DOM was seeded, exactly as on a server, rather than somewhere the
 * render navigated to. `apps/playground-ssr/server.mjs` and this script now do
 * the identical thing.
 *
 * The output was compared before and after as parsed TREES rather than as text.
 * The shape is identical on every page — same nodes, same children, same
 * attribute values. Two things about the bytes changed, and both are a
 * serializer's opinion rather than a render's: attribute ORDER, which no reader
 * of HTML can observe, and `style="display: contents;"` losing its semicolon,
 * because jsdom's CSSOM ends a declaration with one and linkedom's does not.
 * Hydration never compares `style`, and a browser computes the same thing from
 * either.
 *
 * Three pages differ between two consecutive builds, before this change and
 * after it: `/ssr/env`, `/composition/lazy` and `/examples` each render a clock
 * to demonstrate that they were prerendered. That is the demo working.
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

/** The origin the DOM is seeded at. Nothing is served from it; the router reads only the path. */
const ORIGIN = "http://localhost";

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

/**
 * A DOM before the bundle is imported, because importing it is already a render's worth of work:
 * modules that name `document` at the top level run here, and there has to be one for them to name.
 * The per-page DOMs below replace it.
 */
installDom(`${ORIGIN}/`);

const { paths, renderOne } = await import(pathToFileURL(serverBundle).href);

const routePaths = paths();
let bytes = 0;

/**
 * One page, on a DOM seeded at its URL — which is where the router reads the path from.
 *
 * `renderOne` is told the path as well, and that is not the same fact twice: the router needs a
 * `location` to match against, while the page needs the path as a STRING for its canonical and
 * `og:url` tags. Deriving the second from the first would mean reading a global back to learn
 * something the caller already knows.
 */
async function render(routePath) {
  const dom = installDom(new URL(routePath, ORIGIN).href);
  try {
    return await renderOne(routePath);
  } finally {
    dom.close();
  }
}

for (const routePath of routePaths) {
  const html = await render(routePath);
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
const notFoundHtml = await render("/404");
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
