/**
 * Boots the built server and asks it for a page.
 *
 * This exists because of a crash it would have caught. Core runs a block of browser setup at
 * import time in a development build, guarded — at the time — by `typeof document !== "undefined"`.
 * This server gives its Node process a jsdom document, so the guard passed and
 * `customElements.whenDefined` threw `ReferenceError` while the module was still loading. The
 * server died before serving anything, and nothing in the monorepo noticed: every unit test runs
 * in jsdom, where the same code is fine.
 *
 * So the check is deliberately shallow and deliberately REAL: a child process, the actual bundle,
 * an HTTP request. `/` rather than `/products`, because that route fetches from a public API and
 * a smoke test must not depend on the network.
 */
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/**
 * A port the OS says is free, not a constant.
 *
 * 5181 was hard-coded, and it failed once under a parallel turbo run: the second server hit
 * EADDRINUSE and died before answering. The worse version of that bug is silent — a leftover
 * server from an earlier run still listening on 5181 would have ANSWERED, and the smoke test would
 * have passed against a build that no longer exists.
 */
const PORT = await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.on("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

const server = spawn("node", ["server.mjs"], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
for (const stream of [server.stdout, server.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    output += chunk;
  });
}

const stop = () => {
  server.kill("SIGTERM");
};

const fail = (message) => {
  stop();
  console.error(`[smoke] ${message}\n\n--- server output ---\n${output.trim() || "(nothing)"}`);
  process.exit(1);
};

/**
 * Waits for a CONDITION, never for the clock.
 *
 * The port wait below already works this way; the panel checks did not, and used three fixed sleeps
 * instead — 500 ms for the app to boot, 200 ms for the components tab, 500 ms for the editor request
 * to come back. Each one is a bet that a machine running eight other vitest processes is as fast as
 * an idle one, and the last one lost: `clicking the editor button asked the server for nothing`,
 * under a parallel `turbo run check`, passing every time it was run on its own.
 *
 * That failure is worse than a slow test, because it reads as a real regression in the editor
 * endpoint. Polling a predicate is both faster when idle (no sleeping past the answer) and immune
 * when loaded.
 */
async function waitFor(whatWentWrong, predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = predicate();
    if (value) return value;
    if (Date.now() > deadline) fail(`${whatWentWrong} (waited ${timeoutMs}ms)`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * Every request this script makes to the server under test.
 *
 * `connection: close` is the whole reason it exists. Node's fetch keeps connections alive and reuses
 * them; this server is short-lived and closes idle ones, so a reused socket can be closed by the
 * server exactly as the client writes to it. Under a saturated machine that window opens often
 * enough to see: `TypeError: fetch failed / cause=SocketError: other side closed`, roughly one run in
 * three at 2x CPU oversubscription, and never when run alone.
 *
 * That is a property of talking to a throwaway server over keep-alive, not of anything being tested,
 * so it is taken off the table rather than retried around.
 */
const httpGet = (url, init) => fetch(url, { ...init, headers: { ...init?.headers, connection: "close" } });

server.on("exit", (code) => {
  // Exiting before the request is the failure this was written for.
  if (code !== null && code !== 0) fail(`the server exited with code ${code} before serving anything`);
});

/**
 * Waits for the port rather than a fixed sleep, so a slow machine does not fail spuriously.
 *
 * 40 attempts (6 seconds) was not enough: under a full parallel `turbo run test` — eight vitest
 * processes saturating the machine — this failed twice while passing every time it was run on its
 * own. Booting a server that builds a jsdom document is not fast when nothing has a free core.
 * 15 seconds costs nothing on a quiet machine, because the loop exits on the first answer.
 */
async function waitForServer(attempts = 100) {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await httpGet(`http://localhost:${PORT}/`);
      return response;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  return undefined;
}

const response = await waitForServer();
if (!response) fail("the server never answered on port " + PORT);
if (!response.ok) fail(`GET / answered ${response.status}`);

const html = await response.text();
const checks = [
  ["the app's root", '<div id="app">'],
  ["server-rendered content", "<h2>Home</h2>"],
  ["a hydration blob", "data-ramonda-state"],
];

for (const [what, needle] of checks) {
  if (!html.includes(needle)) fail(`GET / is missing ${what} (${needle})`);
}

/**
 * The panel, in the REAL bundle, driven the way a reader drives it.
 *
 * This exists because unit tests could not see two bugs that shipped. The edit pencil packed
 * `nodeId|key|valueId` into one attribute and a value id contains the node's path, which marks a
 * hooks branch with `|h` — so every row under a hook had a pencil that did nothing, while every test
 * tree happened to put state on components whose paths have no `|`. And the editor button sent a
 * sourcemap's `../../..` chain resolved in the browser, where it clamps at the web root, so the
 * server looked for a file that was never there.
 *
 * Both were found by loading this bundle into jsdom and clicking. So that is a check now.
 */
async function checkPanel() {
  const { JSDOM } = await import("jsdom");
  const code = await readFile(join(root, "dist/client/assets/client.js"), "utf8");

  const dom = new JSDOM(html, {
    url: `http://localhost:${PORT}/`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;

  // The app's own fetches are stubbed (the feed talks to a public API, and a smoke test must not),
  // while the panel's own request to the editor endpoint goes to the real server.
  const editorCalls = [];
  window.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("__open-in-editor") || url.includes("/assets/")) {
      /**
       * Recorded BEFORE the await, because what is asserted below is that the panel ASKED — and a
       * request that was made and then failed in transit is still an ask.
       *
       * Pushing after the response instead turned a transport hiccup into
       * `clicking the editor button asked the server for nothing`, which reads as a real regression
       * in the editor button and is not one. The panel had asked, correctly, and even showed its
       * fallback toast for it.
       */
      const call = { url };
      if (url.includes("__open-in-editor")) editorCalls.push(call);

      const answer = await httpGet(url.startsWith("http") ? url : `http://localhost:${PORT}${url}`, init);
      call.status = answer.status;
      return answer;
    }
    return new window.Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };

  window.eval(code);

  const panel = await waitFor("the client did not mount the devtools panel", () =>
    window.document.querySelector("ramonda-devtools"),
  );
  await waitFor("core did not install the devtools write bridge", () => typeof window.__RAMONDA_WRITE__ === "function");

  panel.toggle();
  panel.shadowRoot.querySelector('.tab[data-tab="components"]').dispatchEvent(new window.Event("click"));

  // Five is the "the tree came through at all" bar, not an exact count — the app is free to grow.
  const rows = await waitFor("the panel listed too few components, so the tree did not come through", () => {
    const found = panel.shadowRoot.querySelectorAll(".comp-summary").length;
    return found >= 5 ? found : 0;
  });

  // 1. A pencil, on a row that really exists in this app, and it has to open an editor.
  const pencil = panel.shadowRoot.querySelector("[data-edit-node]");
  if (!pencil) fail("no state is editable anywhere in the tree, which cannot be right");
  pencil.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  await waitFor(`the edit pencil for ${pencil.dataset.editKey} opened nothing (vid: ${pencil.dataset.editVid})`, () =>
    panel.shadowRoot.querySelector(".edit-input"),
  );
  panel.shadowRoot.querySelector(".edit-input").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));

  /**
   * 2. The editor button reaches the endpoint at all.
   *
   * Only that much, and the reason is a limit of this harness rather than of the feature: jsdom cannot
   * execute an ES module, so the bundle is run through `eval` — which makes every stack frame name the
   * eval site instead of a URL. The POSITION is meaningless here, so path resolution is checked
   * separately, against the map, below.
   */
  const open = panel.shadowRoot.querySelector("[data-src-file]");
  if (!open) fail("no component reported where it is defined");
  open.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  await waitFor("clicking the editor button asked the server for nothing", () => editorCalls.length > 0);

  return { rows, editing: pencil.dataset.editKey };
}

/**
 * The endpoint, with the exact shape the panel sends for a bundled build: a source straight out of the
 * map (a `../../..` chain relative to the bundle on disk) plus the module it came from.
 *
 * This is the case that failed in the wild — `packages/router/src/Link.tsx`, resolved against the app
 * root instead of the bundle's real directory, answering 422. Reading the path out of the map rather
 * than writing one down means the test cannot drift from what the build produces.
 */
async function checkEditorEndpoint() {
  const code = await readFile(join(root, "dist/client/assets/client.js"), "utf8");
  const marker = /sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)\s*$/.exec(code);
  if (!marker) fail("the client bundle carries no inline sourcemap, so no position can be resolved");

  const map = JSON.parse(Buffer.from(marker[1], "base64").toString());
  // Prefer a source OUTSIDE this app: the deeper `..` chain is what broke.
  const source = map.sources.find((entry) => entry.includes("/packages/")) ?? map.sources[0];
  if (!source) fail("the sourcemap names no sources");

  const query = `file=${encodeURIComponent(`${source}:1:1`)}&from=${encodeURIComponent("assets/client.js")}`;
  const answer = await httpGet(`http://localhost:${PORT}/__open-in-editor?${query}`);
  const body = await answer.text();

  /**
   * A 500 saying "no editor found" is a PASS, and that is not a lowered bar.
   *
   * The endpoint refuses an unresolvable path with 422 BEFORE it tries to launch anything, so reaching
   * the launch at all is proof the path resolved — which is the whole subject of this check. Whether a
   * machine has an editor to open it with is a property of the machine: `launch-editor` reads $EDITOR
   * and, failing that, guesses from the process table. A developer has one running, a CI runner does
   * not, and this test asserted the developer's desktop for a while. It went red on the first push.
   */
  const noEditorHere = answer.status === 500 && body.startsWith("no editor found");
  if (!answer.ok && !noEditorHere) {
    fail(`the editor endpoint answered ${answer.status} for ${source} (${body})`);
  }

  /**
   * And the negative case, because accepting a 500 must not accept everything.
   *
   * A path that cannot resolve has to still be refused — with 422 specifically, since the panel reads a
   * 404 as "this server has no such endpoint" and quietly falls back to the clipboard. Without this,
   * deleting the `existsSync` guard would leave the check above passing.
   */
  const bogus = `file=${encodeURIComponent("src/NoSuchFile.tsx:1:1")}`;
  const refusal = await httpGet(`http://localhost:${PORT}/__open-in-editor?${bogus}`);
  if (refusal.status !== 422) {
    fail(`a path that does not exist answered ${refusal.status}, but the panel needs 422 to say so`);
  }

  return { source, opened: answer.ok };
}

const panel = await checkPanel();
const editor = await checkEditorEndpoint();

stop();
console.log(
  `[smoke] the server rendered / with ${html.length} bytes, and all ${checks.length} checks passed\n` +
    `[smoke] the panel listed ${panel.rows} components and edited ${panel.editing}\n` +
    `[smoke] the endpoint resolved ${editor.source} ` +
    `(${editor.opened ? "and opened it" : "no editor on this machine, which is not this test's business"}), ` +
    `and refused a path that does not exist`,
);
