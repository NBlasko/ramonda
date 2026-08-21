import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createIsrCache, fileStore } from "@ramonda/router/server";
import { escapeHtml, fillDocument, installDom, mimeFor, parseCookies } from "@ramonda/server";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 5173);
// `--prod` (or NODE_ENV) picks the production path; `--prod` works on every shell,
// including Windows where `NODE_ENV=… node` does not.
const isProd = process.env.NODE_ENV === "production" || process.argv.includes("--prod");

function sendRedirect(res, redirect) {
  res.statusCode = redirect.status;
  res.setHeader("Location", redirect.url);
  res.end();
}

// ── DEV: Vite middleware, hot reload, no build step ─────────────────────────────
// The server module is loaded through `ssrLoadModule`, which re-evaluates it when a
// file changes — so editing a component is picked up on the next request with no
// restart, and the browser gets HMR for the client half. The transform itself comes
// from `@ramonda/build` — see vite.config.ts.
let vite;
// ── PROD: the esbuild bundle. Serves each route by its mode — a baked static file, an
//    ISR page (cached + revalidated), or a fresh per-request render. See src/entry-server.tsx.
let prodRender;
let prodPlan;
let prodPrerender;
let prodTemplate;
let staticSet;
let isr;
const STATIC = resolve(here, "dist/static");
const origin = `http://localhost:${PORT}`;

if (isProd) {
  const bundle = resolve(here, "dist/server/entry-server.js");
  if (!existsSync(bundle)) {
    console.error("Build first: `npm run build` (production serves the built output).");
    process.exit(1);
  }
  // The DOM must exist before the app module is imported: class fields and
  // decorators run at import time and some touch `window`.
  installDom(`http://localhost:${PORT}/`);
  const mod = await import(bundle);
  prodRender = mod.render;
  prodPrerender = mod.prerender;
  prodPlan = mod.plan();
  staticSet = new Set(prodPlan.static);
  isr = createIsrCache({
    plan: prodPlan,
    // Where baked ISR pages live. A directory, so the cache survives a restart and is shared by
    // every instance that mounts it — a plain Map would give each process its own copy and let a
    // visitor bounce between a fresh and a stale one. Instances that share no disk want a store
    // over something they DO share: an `IsrStore` is three methods — `get`, `set` and `delete`.
    // `npm run build` clears this directory, because pages in it were baked by the old bundle.
    store: fileStore({ dir: resolve(here, "dist/isr") }),
    render: bakeShared,
  });
  prodTemplate = readFileSync(resolve(here, "index.html"), "utf8").replace(
    "/src/entry-client.tsx",
    "/assets/client.js",
  );
} else {
  const { createServer: createViteServer } = await import("vite");
  vite = await createViteServer({
    root: here,
    appType: "custom",
    server: { middlewareMode: true },
  });
}

async function renderDev(req, res) {
  const url = req.url ?? "/";
  try {
    installDom(`http://localhost:${PORT}${url}`);
    const rawHtml = await readFile(resolve(here, "index.html"), "utf8");
    const template = await vite.transformIndexHtml(url, rawHtml);
    const { render } = await vite.ssrLoadModule("/src/entry-server.tsx");

    const { html, title, head, portals, redirect } = await render();
    if (redirect) return sendRedirect(res, redirect);

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html");
    res.end(fillDocument({ template, html, title, head, portals }));
  } catch (error) {
    // Rewrites the stack to your source, not the transformed module.
    vite.ssrFixStacktrace(error);
    res.statusCode = 500;
    res.end(`<pre>${escapeHtml(error?.stack ?? error)}</pre>`);
    console.error(error);
  }
}

/**
 * Sends a whole document.
 *
 * The FULL document is what goes in the ISR cache, head included — caching the body alone and
 * filling the shell at send time works until the shell changes under a cached page, and the head is
 * what would silently go stale: page A's cached entry served with whatever title the last render
 * happened to leave.
 */
function sendHtml(res, html, mode) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html");
  res.setHeader("X-Ramonda-Mode", mode);
  res.end(html);
}

/** Renders an ISR/prerender path with the request context poisoned (shared cache, no per-request data). */
async function bakeShared(path) {
  const dom = installDom(`${origin}${path}`);
  try {
    const { html, title, head, portals, blockedBy } = await prodPrerender(path);
    if (blockedBy !== undefined) throw new Error(`Route ${path} is cached but read the request (${blockedBy}).`);
    return fillDocument({ template: prodTemplate, html, title, head, portals });
  } finally {
    dom.close();
  }
}

async function renderProd(req, res) {
  const url = req.url ?? "/";

  if (url.startsWith("/assets/")) {
    const file = join(here, "dist", "client", "assets", url.slice("/assets/".length));
    if (existsSync(file)) {
      res.setHeader("Content-Type", mimeFor(file));
      res.end(readFileSync(file));
      return;
    }
    res.statusCode = 404;
    res.end("Not found");
    return;
  }

  const path = url.split("?")[0];

  try {
    // 1. STATIC — serve the file the build baked (fall through to a live render if it is missing).
    if (staticSet.has(path)) {
      const file = path === "/" ? resolve(STATIC, "index.html") : resolve(STATIC, `.${path}`, "index.html");
      if (existsSync(file)) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html");
        res.setHeader("X-Ramonda-Mode", "static");
        res.end(readFileSync(file, "utf8"));
        return;
      }
    }

    // 2. ISR — serve the cached copy, refreshing it behind the visitor once it is older than
    //    `revalidate`. `serve` answers undefined for anything that is not an ISR route, so a
    //    dynamic route falls straight through to 3.
    const page = await isr.serve(path);
    if (page) return sendHtml(res, page.html, page.mode);

    // 3. DYNAMIC — render per request (url + cookies for requestContext).
    installDom(`${origin}${url}`);
    const { html, title, head, portals, redirect } = await prodRender({
      url: new URL(url, origin),
      cookies: parseCookies(req.headers.cookie),
    });
    if (redirect) return sendRedirect(res, redirect);
    sendHtml(res, fillDocument({ template: prodTemplate, html, title, head, portals }), "dynamic");
  } catch (error) {
    res.statusCode = 500;
    res.end(`<pre>${escapeHtml(error?.stack ?? error)}</pre>`);
    console.error(error);
  }
}

const server = createServer((req, res) => {
  if (isProd) return void renderProd(req, res);
  // Let Vite serve its own routes (client modules, HMR, /@vite/*); fall through to SSR.
  vite.middlewares(req, res, () => renderDev(req, res));
});

server.listen(PORT, () => {
  console.log(`Ramonda SSR on http://localhost:${PORT}  (${isProd ? "production" : "dev — hot reload"})`);
});
