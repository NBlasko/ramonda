// The SSG build loop, end to end: routePlan → renderStatic per path → write HTML files, and FAIL
// LOUDLY if a route marked for prerender read per-request data (it cannot be baked safely). This
// is the dogfood that exercises the whole SSG stack — defineServer, routePlan, renderStatic,
// requestContext — against the real routed app.

import { installDom } from "../installDom.mjs";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const OUT = resolve(root, "dist/static");
const PORT = 5180;
const origin = `http://localhost:${PORT}`;

/** A fresh DOM seeded at a URL — the router reads `window.location`, so this is how it learns the page. */

// The DOM must exist before the app module is imported (class fields/decorators run at import).
await installDom(`${origin}/`);
const { staticPaths, prerender } = await import("../dist/server/entry-server.js");
/**
 * The SHIPPABLE template, not the source one.
 *
 * `index.html` points at `/src/entry-client.tsx`, which exists only under a dev server. The
 * client build rewrites it to `/assets/client.js` on its way into `dist/client`, and this script
 * used to bake the raw one — so every prerendered page shipped a script tag pointing at a file
 * the server does not have. The browser fell through to `index.html`, got `text/html`, and
 * refused the module:
 *
 *   Failed to load module script: Expected a JavaScript-or-Wasm module script but the server
 *   responded with a MIME type of "text/html".
 *
 * Nothing crashed. The page rendered, looked right, and simply never hydrated — no interactivity
 * and no devtools panel — on every static route, while the dynamic ones were fine. Which is why
 * the rewrite is asserted rather than assumed: a `.replace()` that silently matches nothing is
 * exactly how this survived.
 */
const SOURCE_ENTRY = "/src/entry-client.tsx";
const BUILT_ENTRY = "/assets/client.js";

const raw = await readFile(resolve(root, "index.html"), "utf-8");
if (!raw.includes(SOURCE_ENTRY)) {
  console.error(
    `index.html no longer references ${SOURCE_ENTRY}; the prerendered pages would ship an unhydrated template.`,
  );
  process.exit(1);
}
const template = raw.replace(SOURCE_ENTRY, BUILT_ENTRY);

// Every page in the ISR cache was baked by the bundle this build just replaced, so serving one
// afterwards hands the browser old markup for a new client bundle — a hydration mismatch, and old
// content until that route's revalidate window happens to pass. A build is the deploy boundary, so
// clearing it here is the one place it cannot be forgotten.
await rm(resolve(root, "dist/isr"), { recursive: true, force: true });

const paths = staticPaths();
console.log(`Prerendering ${paths.length} static route(s): ${paths.join(", ")}\n`);

let blocked = 0;
for (const path of paths) {
  // Point the DOM at this path first, so the router matches it.
  await installDom(`${origin}${path}`);
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
