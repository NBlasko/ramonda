import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, resolve } from "node:path";
import { JSDOM } from "jsdom";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 5173);
const ASSETS = resolve(here, "dist", "client", "assets");
const SERVER_BUNDLE = resolve(here, "dist", "server", "entry-server.js");

const template = readFileSync(resolve(here, "index.html"), "utf8");

const MIME = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

/**
 * Ramonda's server render builds real DOM elements, so Node needs a DOM. This
 * installs a fresh one per request, seeded at the request URL — which is also
 * how the router learns which page it is on.
 *
 * `defineProperty`, not assignment: Node ships `navigator`/`location` as
 * getter-only globals, so `globalThis.location = …` would throw.
 */
function installDom(url) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url });
  const put = (name, value) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  for (const name of [
    "window", "document", "navigator", "location", "history",
    "HTMLElement", "SVGElement", "Node", "Text", "CustomEvent", "Event", "MouseEvent", "getComputedStyle",
  ]) {
    put(name, dom.window[name]);
  }
  put("requestAnimationFrame", (cb) => setTimeout(() => cb(Date.now()), 0));
  put("cancelAnimationFrame", (id) => clearTimeout(id));
  return dom;
}

if (!existsSync(SERVER_BUNDLE)) {
  console.error("Build first: `npm run build` (this server runs the built output).");
  process.exit(1);
}

// The DOM must exist before the app module is imported: class fields and
// decorators run at import time and some touch `window`.
installDom(`http://localhost:${PORT}/`);
const { render } = await import(SERVER_BUNDLE);

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";

  // Static assets built by esbuild.
  if (url.startsWith("/assets/")) {
    const file = join(ASSETS, url.slice("/assets/".length));
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
    const body = await render();
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html");
    res.end(template.replace("<!--ssr-->", body));
  } catch (error) {
    res.statusCode = 500;
    res.end(`<pre>${String(error?.stack ?? error)}</pre>`);
    console.error(error);
  }
});

server.listen(PORT, () => console.log(`Ramonda SSR on http://localhost:${PORT}`));
