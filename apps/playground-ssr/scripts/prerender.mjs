// The SSG build loop, end to end: routePlan → renderStatic per path → write HTML files, and FAIL
// LOUDLY if a route marked for prerender read per-request data (it cannot be baked safely). This
// is the dogfood that exercises the whole SSG stack — defineServer, routePlan, renderStatic,
// requestContext — against the real routed app.

import { JSDOM } from "jsdom";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const OUT = resolve(root, "dist/static");
const PORT = 5180;
const origin = `http://localhost:${PORT}`;

/** A fresh DOM seeded at a URL — the router reads `window.location`, so this is how it learns the page. */
function installDom(url) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url });
  const put = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
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
    "CustomEvent",
    "Event",
    "MouseEvent",
    "getComputedStyle",
  ]) {
    put(name, dom.window[name]);
  }
  put("requestAnimationFrame", (cb) => setTimeout(() => cb(Date.now()), 0));
  put("cancelAnimationFrame", (id) => clearTimeout(id));
  return dom;
}

// The DOM must exist before the app module is imported (class fields/decorators run at import).
installDom(`${origin}/`);
const { staticPaths, prerender } = await import("../dist/server/entry-server.js");
const template = await readFile(resolve(root, "index.html"), "utf-8");

const paths = staticPaths();
console.log(`Prerendering ${paths.length} static route(s): ${paths.join(", ")}\n`);

let blocked = 0;
for (const path of paths) {
  // Point the DOM at this path first, so the router matches it.
  installDom(`${origin}${path}`);
  const { html, blockedBy } = await prerender(path);

  if (blockedBy !== undefined) {
    console.error(`  ✗ ${path} — reads the request (${blockedBy}); cannot be prerendered.`);
    blocked++;
    continue;
  }

  const file = path === "/" ? join(OUT, "index.html") : join(OUT, path, "index.html");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, template.replace("<!--ssr-->", html));
  console.log(`  ✓ ${path} → ${file.replace(root + "/", "")}`);
}

if (blocked > 0) {
  console.error(`\n${blocked} route(s) marked prerender read per-request data. Fix the config or the route.`);
  process.exit(1);
}
console.log(`\nPrerendered ${paths.length} route(s) into dist/static.`);
