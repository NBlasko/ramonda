import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Serves `dist/` the way a static host does, so the built site can be checked
 * before it is deployed anywhere.
 *
 * The directory→`index.html` rule is the one thing worth getting right: the
 * build writes `/guide/installation/index.html`, and every static host resolves
 * `/guide/installation` to it. A dev server that did not would make the links
 * work locally and 404 in production.
 */
const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const PORT = Number(process.env.PORT ?? 5173);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  let file = join(dist, url);
  let status = 200;

  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  // Clean URLs: `/guide/installation` is served from the flat file
  // `guide/installation.html`, the way Cloudflare Pages resolves it. Without this
  // the built site 404s locally while working in production.
  else if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`;
  if (!existsSync(file)) {
    // Serve the prerendered not-found page WITH a 404 status, the way a static
    // host does — a 200 on a missing URL would be a lie to crawlers and caches.
    file = join(dist, "404.html");
    status = 404;
  }
  if (!existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
    return;
  }

  res.writeHead(status, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`[docs] http://localhost:${PORT}`));
