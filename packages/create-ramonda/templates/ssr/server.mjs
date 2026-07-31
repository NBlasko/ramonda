import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, resolve } from "node:path";
import { JSDOM } from "jsdom";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 5173);
// `--prod` (or NODE_ENV) picks the production path; `--prod` works on every shell,
// including Windows where `NODE_ENV=… node` does not.
const isProd = process.env.NODE_ENV === "production" || process.argv.includes("--prod");

const MIME = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

/**
 * Ramonda's server render builds real DOM elements, so Node needs a DOM. This
 * installs a fresh one per request, seeded at the request URL — which is also how
 * the router learns which page it is on.
 *
 * `defineProperty`, not assignment: Node ships `navigator`/`location` as
 * getter-only globals, so `globalThis.location = …` would throw.
 */
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

function sendRedirect(res, redirect) {
  res.statusCode = redirect.status;
  res.setHeader("Location", redirect.url);
  res.end();
}

// ── DEV: Vite middleware, hot reload, no build step ─────────────────────────────
// The server module is loaded through `ssrLoadModule`, which re-evaluates it when a
// file changes — so editing a component is picked up on the next request with no
// restart, and the browser gets HMR for the client half. See vite.config.ts for the
// one setting (es2022) that makes this work with decorators.
let vite;
// ── PROD: the esbuild bundle, served as static + one Node render ────────────────
let prodRender;
let prodTemplate;

if (isProd) {
  const bundle = resolve(here, "dist/server/entry-server.js");
  if (!existsSync(bundle)) {
    console.error("Build first: `npm run build` (production serves the built output).");
    process.exit(1);
  }
  // The DOM must exist before the app module is imported: class fields and
  // decorators run at import time and some touch `window`.
  installDom(`http://localhost:${PORT}/`);
  prodRender = (await import(bundle)).render;
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

    const { html, redirect } = await render();
    if (redirect) return sendRedirect(res, redirect);

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html");
    res.end(template.replace("<!--ssr-->", html));
  } catch (error) {
    // Rewrites the stack to your source, not the transformed module.
    vite.ssrFixStacktrace(error);
    res.statusCode = 500;
    res.end(`<pre>${String(error?.stack ?? error)}</pre>`);
    console.error(error);
  }
}

async function renderProd(req, res) {
  const url = req.url ?? "/";

  if (url.startsWith("/assets/")) {
    const file = join(here, "dist", "client", "assets", url.slice("/assets/".length));
    if (existsSync(file)) {
      res.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream");
      res.end(readFileSync(file));
      return;
    }
    res.statusCode = 404;
    res.end("Not found");
    return;
  }

  try {
    installDom(`http://localhost:${PORT}${url}`);
    const { html, redirect } = await prodRender();
    if (redirect) return sendRedirect(res, redirect);

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html");
    res.end(prodTemplate.replace("<!--ssr-->", html));
  } catch (error) {
    res.statusCode = 500;
    res.end(`<pre>${String(error?.stack ?? error)}</pre>`);
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
