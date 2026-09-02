import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, extname, dirname, resolve, sep } from "node:path";
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
const dist = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const PORT = Number(process.env.PORT ?? 5173);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

/**
 * The path a request asks for, built from segments that CANNOT traverse.
 *
 * The first version resolved `join(dist, url)` and then checked the result was inside `dist`. That
 * is correct — measured, `/../../../etc/passwd` went from serving the file to a 403 — and CodeQL
 * still reported it, because the check sat in a different function from the `existsSync` calls and
 * its taint tracking does not follow a guard across that boundary.
 *
 * So the traversal is removed rather than caught: the URL is split, and `..`, `.` and empty
 * segments are DROPPED. What reaches `join` is a list of plain names, so there is nothing for a
 * path to climb with — no check to be trusted, and none to be forgotten by whoever edits the
 * resolution below.
 *
 * The containment test stays underneath it anyway. It should now be unreachable, and a guard that
 * costs one string comparison is not worth removing to prove a point.
 *
 * `decodeURIComponent` throws on a stray `%`, which took the server down for a malformed URL a
 * crawler produces by accident. A request nobody can decode is a request nobody can serve.
 */
function asked(rawUrl) {
  let url;
  try {
    url = decodeURIComponent((rawUrl ?? "/").split("?")[0]);
  } catch {
    return undefined;
  }

  const parts = url.split("/").filter((part) => part !== "" && part !== "." && part !== "..");
  const at = resolve(dist, ...parts);
  return at === dist || at.startsWith(dist + sep) ? at : undefined;
}

createServer((req, res) => {
  let file = asked(req.url);
  let status = 200;

  if (file === undefined) {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("Forbidden");
    return;
  }

  /**
   * The FLAT file first, and the order is the whole fix.
   *
   * `/guide/installation` is served from `guide/installation.html`, the way Cloudflare Pages
   * resolves it — `outputPath` in `prerender.mjs` explains why the build is laid out that way.
   *
   * The directory test used to come first, which was harmless while no route had both a page and
   * children. `/reference/diagnostics` now has both: the page is `reference/diagnostics.html` and
   * the codes under it are `reference/diagnostics/rmd003.html`. The directory won, `index.html`
   * inside it does not exist, and an index page that production serves perfectly well 404'd here.
   *
   * Which is this file's own warning pointed the other way: a dev server that disagrees with the
   * host is worth nothing whichever direction it disagrees in.
   */
  if (existsSync(`${file}.html`)) file = `${file}.html`;
  else if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
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
