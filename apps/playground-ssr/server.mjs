import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, resolve } from "node:path";
import { JSDOM } from "jsdom";

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
function installDom(url) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url });

  // defineProperty, not assignment: Node ships `navigator` and `location` as
  // getter-only globals, so `globalThis.navigator = ...` throws outright.
  const put = (name, value) =>
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
    });

  for (const name of [
    "window",
    "document",
    "navigator",
    "location",
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

const MIME = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// The DOM has to exist before the app module is evaluated: class fields and
// decorators run at import time and some of them touch `window`.
installDom(`http://localhost:${PORT}/`);
const { render } = await import("./dist/server/entry-server.js");
const template = await readFile(resolve(CLIENT, "index.html"), "utf-8");

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

    const [, relative, line = "1", column = "1"] = /^(.*?):(\d+)?:?(\d+)?$/.exec(target) ?? [, target];

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
    res.setHeader("Content-Type", MIME[extname(asset)] ?? "application/octet-stream");
    createReadStream(asset).pipe(res);
    return;
  }

  try {
    // Seeding the router IS pointing the shim at the request URL. No server-only
    // entry point into the router, and there should not be one: a second way to
    // say "you are at /users/42" is a second thing to keep honest.
    const dom = installDom(`http://localhost:${PORT}${url}`);

    const started = process.hrtime.bigint();
    const { html, redirect } = await render();
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    dom.window.close();

    if (redirect) {
      // A route guard sent this request elsewhere — answer with the redirect so the
      // browser navigates there and requests the correct page.
      res.statusCode = redirect.status;
      res.setHeader("Location", redirect.url);
      res.end();
      console.log(`${req.method} ${url} → ${redirect.status} ${redirect.url}`);
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html");
    res.setHeader("Server-Timing", `render;dur=${ms.toFixed(1)}`);
    res.end(template.replace("<!--ssr-->", html));
    console.log(`${req.method} ${url} → ${ms.toFixed(1)}ms, ${html.length}b`);
  } catch (error) {
    res.statusCode = 500;
    res.end(`<pre>${String(error?.stack ?? error)}</pre>`);
    console.error(error);
  }
});

server.listen(PORT, () => console.log(`Ramonda SSR on http://localhost:${PORT}`));
