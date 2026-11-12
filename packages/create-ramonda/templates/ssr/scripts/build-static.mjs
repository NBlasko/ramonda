import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installDom } from "@ramonda/server";

/**
 * `npm run build:static` — the whole site as ONE folder, `dist/site`, for a host that only serves
 * files: the baked pages, `404.html`, the scripts and everything from `public/`. Upload that folder.
 *
 * Only when every route is baked at build. A route that renders per request, or is re-baked on a
 * timer, needs `server.mjs` running, so a folder of files would serve it as a missing page — it is
 * refused here, by name, rather than uploaded half-working.
 *
 * A page is `about/index.html`, so `/about` is served by a host that maps a folder to its
 * `index.html`, which static hosts do; most also redirect `/about/` to `/about` or the reverse,
 * and the router reads either one as the same route.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

// The app module touches `window` as it loads, as in scripts/prerender.mjs.
installDom("http://localhost:5173/");
const { plan } = await import("../dist/server/entry-server.js");
const routes = plan();
const notBaked = [...routes.server, ...routes.isr.map((route) => route.path)];
if (notBaked.length > 0) {
  console.error(
    `${notBaked.length} route(s) are not baked at build, so a folder of files cannot serve them: ${notBaked.join(", ")}.\n` +
      "Mark each `prerender: true` in src/entry-server.tsx, or deploy with `npm start`, which serves them.",
  );
  process.exit(1);
}

const site = join(dist, "site");
rmSync(site, { recursive: true, force: true });
// The scripts and `public/`, without the page shell — every page is baked from it already.
const shell = join(dist, "client", "index.html");
cpSync(join(dist, "client"), site, { recursive: true, filter: (from) => from !== shell });
cpSync(join(dist, "static"), site, { recursive: true });
if (!existsSync(join(site, "index.html"))) {
  console.error("dist/static has no index.html — `npm run build` bakes the pages first.");
  process.exit(1);
}
console.log("The site is in dist/site — upload that folder.");
