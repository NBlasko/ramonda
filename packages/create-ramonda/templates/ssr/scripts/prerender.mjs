// The SSG build step: routePlan → renderStatic per static route → write HTML files, and FAIL
// LOUDLY if a route marked prerender read per-request data (it cannot be baked safely). Run
// after the server bundle is built; `npm run build` wires this up.

import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installDom } from "../installDom.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const OUT = resolve(root, "dist/static");
const origin = "http://localhost:5173";


// The DOM must exist before the app module is imported (class fields/decorators run at import).
installDom(`${origin}/`);
const { staticPaths, prerender } = await import("../dist/server/entry-server.js");
const template = (await readFile(resolve(root, "index.html"), "utf-8")).replace(
  "/src/entry-client.tsx",
  "/assets/client.js",
);

// Every page in the ISR cache was baked by the bundle this build just replaced, so serving one
// afterwards hands the browser old markup for a new client bundle — a hydration mismatch, and old
// content until that route's revalidate window happens to pass. A build is the deploy boundary, so
// clearing it here is the one place it cannot be forgotten.
await rm(resolve(root, "dist/isr"), { recursive: true, force: true });

const paths = staticPaths();
console.log(`Prerendering ${paths.length} static route(s): ${paths.join(", ") || "(none)"}\n`);

let blocked = 0;
for (const path of paths) {
  installDom(`${origin}${path}`); // point the DOM at this path so the router matches it
  const { html, blockedBy } = await prerender(path);

  if (blockedBy !== undefined) {
    console.error(`  ✗ ${path} — reads the request (${blockedBy}); cannot be prerendered.`);
    blocked++;
    continue;
  }

  const file = path === "/" ? join(OUT, "index.html") : join(OUT, path, "index.html");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, template.replace("<!--ssr-->", html));
  console.log(`  ✓ ${path}`);
}

if (blocked > 0) {
  console.error(`\n${blocked} route(s) marked prerender read per-request data. Fix the config or the route.`);
  process.exit(1);
}
console.log(`\nPrerendered ${paths.length} route(s) into dist/static.`);
