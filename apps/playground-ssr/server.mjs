import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { escapeHtml, fillDocument, installDom, mimeFor, parseCookies } from "@ramonda/server";
import { createIsrCache, fileStore } from "@ramonda/router/server";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 5180);
const CLIENT = resolve(here, "dist/client");

/**
 * A Ramonda app rendered by a real Node process.
 *
 * Every SSR test until now ran in one jsdom, in one process, with state blobs
 * injected by hand — so a whole class of bug stayed invisible: anything that is
 * per-process on the server and absent on the client. The AsyncLoad hydration
 * crash was exactly that, and reproducing it needed a forged blob.
 *
 * Built, not loaded through vite's dev transform, for a concrete reason: the dev
 * transform leaves TC39 decorators in place. Chrome parses them natively so the
 * browser playground works, but Node does not, and `ssrLoadModule` failed with
 * "Invalid or unexpected token" on `@Host("div") class …`. The production build
 * does transform them, so the server runs built output.
 */

// The DOM has to exist before the app module is evaluated: class fields and
// decorators run at import time and some of them touch `window`.
installDom(`http://localhost:${PORT}/`);
const { render, plan, prerender } = await import("./dist/server/entry-server.js");
const template = await readFile(resolve(CLIENT, "index.html"), "utf-8");

// The render plan, computed once: which paths are baked (static), cached-and-revalidated (isr),
// or rendered per request (everything else). See @ramonda/router/server `routePlan`.
const routePlan = plan();
const STATIC = resolve(here, "dist/static");
const staticSet = new Set(routePlan.static);

/**
 * The ISR cache. A directory rather than a Map, which is the whole point: it survives a restart,
 * and two instances mounting it agree about how old a page is instead of each ageing its own copy.
 * Instances that share no disk plug in a store over something they do share — `IsrStore` is two
 * methods. `npm run build` clears it, because pages in it were baked by the previous bundle.
 */
const isr = createIsrCache({
  plan: routePlan,
  store: fileStore({ dir: resolve(here, "dist/isr") }),
  render: (path) => bakeShared(path),
});

const origin = `http://localhost:${PORT}`;

function sendHtml(res, html, mode) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html");
  res.setHeader("X-Ramonda-Mode", mode);
  res.end(html);
}

/**
 * Puts one render into the shell: body, title, and the head tags the `Head` chain
 * resolved to.
 *
 * The title is REPLACED rather than appended to — two `<title>` elements is not a
 * document with a fallback, it is a document a crawler reads the first of. A page
 * that set none keeps the shell's.
 */
const fillTemplate = ({ html, title, head, portals }) => fillDocument({ template, html, title, head, portals });

/** Renders an ISR/prerender path with the request context poisoned (shared cache, no per-request data). */
async function bakeShared(path) {
  const dom = installDom(`${origin}${path}`);
  try {
    const { html, title, head, portals, blockedBy } = await prerender(path);
    if (blockedBy !== undefined) {
      throw new Error(`Route ${path} is cached (static/isr) but read the request (${blockedBy}).`);
    }
    // The FULL document is what goes in the cache, head included. Caching the body
    // alone and filling the shell at send time would work until the shell changed
    // under a cached page — and the head is what would silently go stale.
    return fillTemplate({ html, title, head, portals });
  } finally {
    dom.close();
  }
}

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";

  /**
   * The endpoint devtools' `</>` button calls, which Vite provides and a hand-written server does
   * not — so this app had a button that could only ever copy a path to the clipboard.
   *
   * `launch-editor` is what Vite uses underneath: it finds the editor already running and opens the
   * file at the line. The path arrives project-relative (`src/ProductsPage.tsx:42:8`), which is what
   * the panel sends and what this server resolves against its own root.
   */
  if (url.startsWith("/__open-in-editor")) {
    const target = new URL(url, `http://localhost:${PORT}`).searchParams.get("file");
    if (!target) {
      res.statusCode = 400;
      res.end("no file");
      return;
    }

    // Written out rather than destructured with a `?? [, target]` fallback: that fallback was a sparse
    // array, which oxlint refuses — and rightly, since a hole in an array literal is almost always a typo.
    const at = /^(.*?):(\d+)?:?(\d+)?$/.exec(target);
    const relative = at?.[1] ?? target;
    const line = at?.[2] ?? "1";
    const column = at?.[3] ?? "1";

    /**
     * `from` is the module the position came out of, and it is what a RELATIVE source is relative to.
     *
     * A bundle's sourcemap names its inputs as a `../../..` chain out of the bundle's own directory on
     * disk (`dist/client/assets/`), so `packages/router/src/Link.tsx` resolved against the app root is
     * a file that does not exist — which is exactly the 422 that showed up in the log. Resolving it
     * against the served module's real location is the arithmetic the map intended, and only this side
     * can do it: it is the one that knows a URL of `/assets/client.js` is a file under `dist/client`.
     */
    const from = new URL(url, `http://localhost:${PORT}`).searchParams.get("from");
    const base = from ? dirname(resolve(CLIENT, `.${from.startsWith("/") ? from : `/${from}`}`)) : here;
    const file = resolve(base, relative ?? target);

    /**
     * Checked here, because `launch-editor` returns SILENTLY when the file does not exist — no
     * callback, no log, nothing. That silence plus a 200 is how this endpoint managed to report
     * success while doing absolutely nothing, which is the one failure mode a devtools button must
     * not have.
     */
    if (!existsSync(file)) {
      // 422, not 404: to the panel a 404 means "this server has no such endpoint" and sends it to the
      // clipboard fallback. This endpoint exists and is refusing a specific path, which is a different
      // thing to be told.
      console.warn(`[open-in-editor] no such file: ${file}`);
      res.statusCode = 422;
      res.end(`no such file: ${relative}`);
      return;
    }

    try {
      const { default: launch } = await import("launch-editor");
      // The error callback is the only way to hear about a spawn that failed; without it the failure
      // is a line on the server's console and a 200 to the browser.
      let failure;
      launch(`${file}:${line}:${column}`, undefined, (_file, message) => {
        failure = message ?? "no editor found — set $EDITOR, or open the project in one";
      });

      // `launch` spawns synchronously enough that the callback has run for the cases it can detect.
      if (failure) {
        console.warn(`[open-in-editor] ${failure}`);
        res.statusCode = 500;
        res.end(failure);
        return;
      }

      console.log(`[open-in-editor] ${relative}:${line}:${column}`);
      res.statusCode = 200;
      res.end("ok");
    } catch (error) {
      console.error("[open-in-editor]", error);
      res.statusCode = 500;
      res.end(String(error instanceof Error ? error.message : error));
    }
    return;
  }

  const asset = resolve(CLIENT, "." + url);
  if (url !== "/" && asset.startsWith(CLIENT) && existsSync(asset)) {
    res.setHeader("Content-Type", mimeFor(asset));
    createReadStream(asset).pipe(res);
    return;
  }

  const path = url.split("?")[0];

  try {
    // 1. STATIC — a route the build baked. Serve the file; fall through to a live render only if
    //    it was never prerendered (a dev convenience — in production these always exist).
    if (staticSet.has(path)) {
      const file = path === "/" ? resolve(STATIC, "index.html") : resolve(STATIC, `.${path}`, "index.html");
      if (existsSync(file)) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html");
        res.setHeader("X-Ramonda-Mode", "static");
        createReadStream(file).pipe(res);
        console.log(`${req.method} ${url} → static`);
        return;
      }
    }

    // 2. ISR — serve the cached copy; when it is older than `revalidate`, serve it anyway and
    //    refresh in the background (stale-while-revalidate). Cold first hit renders inline. ISR is
    //    a SHARED cache, so it is rendered with the request poisoned — no per-request data in it.
    const page = await isr.serve(path);
    if (page) {
      sendHtml(res, page.html, page.mode);
      console.log(`${req.method} ${url} → ${page.mode}`);
      return;
    }

    // 3. DYNAMIC — rendered per request. The request context (url + cookies) is what a route
    //    reads for auth / per-user output; the router reads the URL off the shimmed `window`.
    const dom = installDom(`${origin}${url}`);
    const started = process.hrtime.bigint();
    const { html, title, head, portals, redirect } = await render({
      url: new URL(url, origin),
      cookies: parseCookies(req.headers.cookie),
    });
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    dom.close();

    if (redirect) {
      // A route guard sent this request elsewhere — answer with the redirect so the
      // browser navigates there and requests the correct page.
      res.statusCode = redirect.status;
      res.setHeader("Location", redirect.url);
      res.end();
      console.log(`${req.method} ${url} → ${redirect.status} ${redirect.url}`);
      return;
    }

    res.setHeader("Server-Timing", `render;dur=${ms.toFixed(1)}`);
    sendHtml(res, fillTemplate({ html, title, head, portals }), "dynamic");
    console.log(`${req.method} ${url} → ${ms.toFixed(1)}ms, ${html.length}b`);
  } catch (error) {
    res.statusCode = 500;
    res.end(`<pre>${escapeHtml(error?.stack ?? error)}</pre>`);
    console.error(error);
  }
});

server.listen(PORT, () => console.log(`Ramonda SSR on http://localhost:${PORT}`));
