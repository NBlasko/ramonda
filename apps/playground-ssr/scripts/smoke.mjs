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
    // Awaited, so an ASYNC predicate works too — a bare `predicate()` hands back a promise, and a
    // promise is truthy, so such a poll would pass on its first turn no matter what it asked.
    const value = await predicate();
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
];

for (const [what, needle] of checks) {
  if (!html.includes(needle)) fail(`GET / is missing ${what} (${needle})`);
}

/**
 * The component markers, and the state blob on one of them.
 *
 * `data-ramonda-state` used to be an attribute on each component's host element. A component owns a
 * RANGE of nodes now, so the pair of comments around that range is what says where it begins and
 * ends — and the opening one carries the state. Served markup is text; this is the only thing in it
 * that can say a component is here.
 */
if (!/<!--c\d+/.test(html)) fail("GET / carries no component markers, so a client has nothing to hydrate against");
if (!/<!--c\d+ \{"state"/.test(html)) fail("GET / carries no state blob on any marker");

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

  /**
   * The tabs this app's packages contribute, before anything else is asked of the panel.
   *
   * They are not in the panel: `@ramonda/query/devtools` and `@ramonda/form/devtools` each describe
   * one and register it when the entry is imported, so an app that uses those packages has to import
   * their entries too. Both playgrounds silently stopped doing that, and nothing said so — the panel
   * still opened, the tree still worked, and two tabs were simply gone. `plugin-` is the prefix the
   * registry puts on a tab it was handed.
   */
  for (const [id, entry] of [
    ["plugin-query", "@ramonda/query/devtools"],
    ["plugin-forms", "@ramonda/form/devtools"],
  ]) {
    if (!panel.shadowRoot.querySelector(`.tab[data-tab="${id}"]`)) {
      fail(`the panel has no ${id.replace("plugin-", "").toUpperCase()} tab — does entry-client import ${entry}?`);
    }
  }

  /**
   * The QUERY tab has something in it.
   *
   * Its existence is not enough, and that gap shipped: `QueryClientProvider` announced its client
   * from `@create`, which runs during hydration — while `@ramonda/query/devtools` arrives through a
   * dynamic import that resolves after. The one announcement went to nobody, and because the root
   * provider never mounts again the tab was empty for the life of the page. The panel asks on load
   * now, and the provider answers; this is what would notice if either half went away.
   */
  panel.shadowRoot.querySelector('.tab[data-tab="plugin-query"]').dispatchEvent(new window.Event("click"));
  await new Promise((r) => setTimeout(r, 600));
  const registry = window.__RAMONDA_PANELS__;
  const query = registry?.list().find((plugin) => plugin.id === "query");
  if (!query) fail("no QUERY plugin in the registry — does entry-client import @ramonda/query/devtools?");
  const queryRows = query.snapshot().groups.length;
  if (queryRows === 0) {
    fail(
      "the QUERY tab knows of no client. `QueryClientProvider` announces from `@create`, which runs\n" +
        "  during hydration — before the dynamic import of `@ramonda/query/devtools` has resolved. The\n" +
        "  panel has to ASK on load and the provider has to answer; one of those two is gone.",
    );
  }

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

  return { rows, editing: pencil.dataset.editKey, queryRows };
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

/**
 * The form, server-rendered and then adopted.
 *
 * `@ramonda/form` builds its field tree out of a Proxy and mints row ids from a counter, and
 * neither of those can be trusted across a server/client boundary on the strength of a unit
 * test: the questions are whether the two sides agree, and whether hydration ADOPTS the markup
 * or silently rebuilds it. Both were wrong once. Row ids came out of a single per-form counter,
 * so an id depended on the order the arrays happened to be read in, and `isValid` was `true` on
 * an empty required form because nothing had validated yet.
 */
async function checkForm() {
  const { JSDOM } = await import("jsdom");
  const code = await readFile(join(root, "dist/client/assets/client.js"), "utf8");

  const served = await fetch(`http://localhost:${PORT}/signup`);
  if (!served.ok) fail(`GET /signup answered ${served.status}`);
  const page = await served.text();

  const read = (id, source) => new RegExp(`<dd id="${id}">([^<]*)<`).exec(source)?.[1];
  const names = (source) => [...source.matchAll(/<input[^>]*name="([^"]+)"/g)].map((m) => m[1]);

  // Every control has a `name`, which is what a form that works without JavaScript would post
  // under — including the bracketed paths of an array field.
  const posted = names(page);
  for (const expected of ["email", "address.street", "tags[0]", "contacts[0].kind"]) {
    if (!posted.includes(expected)) fail(`the server-rendered form has no input named ${expected}`);
  }
  // A form nobody has touched shows no messages, and does not claim to be valid when it is not.
  if (page.includes('class="err"')) fail("the untouched form rendered an error message");
  if (read("s-valid", page) !== "false") fail("the empty signup form reported itself valid");

  const dom = new JSDOM(page, {
    url: `http://localhost:${PORT}/signup`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.fetch = async () => new window.Response("{}", { status: 200 });

  const noise = [];
  for (const level of ["warn", "error"]) {
    const original = window.console[level];
    window.console[level] = (...args) => {
      noise.push(`${level}: ${args.map(String).join(" ")}`);
      original?.(...args);
    };
  }

  // Held as a NODE, not marked with an attribute: the diff removes attributes it does not know
  // about, so a marker would read as a replacement even where the element was adopted.
  const serverEmail = window.document.querySelector("#email");

  window.eval(code);
  await new Promise((resolve) => setTimeout(resolve, 300));

  const doc = window.document;
  if (doc.querySelector("#email") !== serverEmail) fail("hydration replaced the form's markup instead of adopting it");
  if (read("s-rowids", page) !== doc.querySelector("#s-rowids").textContent) {
    fail(
      `the row ids disagree: server ${read("s-rowids", page)}, client ${doc.querySelector("#s-rowids").textContent}`,
    );
  }
  if (JSON.stringify(posted) !== JSON.stringify(names(doc.documentElement.outerHTML))) {
    fail("hydration changed which inputs exist");
  }

  const type = (selector, value) => {
    const el = doc.querySelector(selector);
    el.value = value;
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  const click = (selector) => doc.querySelector(selector).dispatchEvent(new window.Event("click", { bubbles: true }));

  type("#email", "not-an-email");
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (!doc.querySelector("#signup em.err")) fail("typing an invalid email produced no message after hydration");

  type("#email", "a@b.c");
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (doc.querySelector("#signup em.err")) fail("fixing the email left its message on screen");

  // The row identity, which is the whole reason the ids exist: mark the SECOND row's element,
  // remove the FIRST, and the survivor must be the same element rather than a rebuilt one.
  click("#add-tag");
  await new Promise((resolve) => setTimeout(resolve, 50));
  const secondRow = [...doc.querySelectorAll("#tags li input.tag")][1];
  if (!secondRow) fail("adding a tag did not add a row");

  click("#tags .remove-tag");
  await new Promise((resolve) => setTimeout(resolve, 50));
  const survivor = doc.querySelector("#tags li input.tag");
  if (survivor !== secondRow) fail("removing row 0 rebuilt the surviving row instead of moving it");

  if (noise.length > 0) fail(`the form logged during hydration and use:\n${noise.join("\n")}`);

  return { inputs: posted.length, rowids: doc.querySelector("#s-rowids").textContent };
}

/**
 * Every render MODE, because only one of the three was ever requested here.
 *
 * `/` is static — a file read, no render at all — and it is what every check above asks for. So the
 * two paths that actually build a DOM per render went untested, and both broke at once: switching to
 * linkedom left `dom.window.close()` at the end of them, which jsdom answers and linkedom does not.
 * A scaffolded app carried the same line. Neither unit tests nor this script noticed, because neither
 * asked for a page that renders.
 *
 * The ISR half is the reason this is not just two status codes. A background rebake that throws is
 * CAUGHT — the visitor keeps getting the stale copy and the server logs a stack — so a dead
 * revalidation looks exactly like a working one from the outside. What separates them is the mode
 * going back to `isr-hit`: only a rebake that finished writes a fresh entry, and only a fresh entry
 * ends the stale window.
 */
async function checkModes() {
  const modeOf = async (path) => {
    const answer = await httpGet(`http://localhost:${PORT}${path}`);
    if (!answer.ok) fail(`GET ${path} answered ${answer.status}`);
    return { mode: answer.headers.get("x-ramonda-mode"), body: await answer.text() };
  };

  // DYNAMIC — rendered per request, and the id has to have come out of the URL on the server.
  const user = await modeOf("/users/42");
  if (user.mode !== "dynamic") fail(`/users/42 served as ${user.mode}, expected a per-request render`);
  if (!user.body.includes("<h2>User 42</h2>")) fail("the dynamic route did not render the id from the URL");

  /**
   * STATIC, from a :param route — the case the build had no example of.
   *
   * Same shape as `/users/42` above and the opposite mode, which is the point: whether a
   * parameterised route is baked or rendered is the app's declaration, not something the pattern
   * decides. And it proves the file is real: the build used to put this page in a directory named
   * `:slug`, where no request could ever reach it.
   */
  const guide = await modeOf("/guide/state");
  if (guide.mode !== "static") fail(`/guide/state served as ${guide.mode}, expected a baked file`);
  if (!guide.body.includes("<h2>Guide: state</h2>")) fail("the baked :param page has no content in it");

  // ISR — served from the cache, and rebaked behind the visitor's back.
  const first = await modeOf("/about");
  if (!first.mode?.startsWith("isr")) fail(`/about served as ${first.mode}, expected an ISR mode`);
  if (!first.body.includes("<h2>About</h2>")) fail("the ISR route served a page with no content in it");

  // `revalidate: 3`, so the window is the server's clock and cannot be polled away — but polling
  // means not sleeping past the answer either.
  await waitFor("the ISR page never went stale", async () => (await modeOf("/about")).mode === "isr-stale", 20_000);
  await waitFor(
    "the background rebake never produced a fresh page, so revalidation is broken",
    async () => (await modeOf("/about")).mode === "isr-hit",
    20_000,
  );
}

/**
 * A portal into a NAMED target, across the whole pipeline.
 *
 * The plan for `Portal` was that a portalled subtree should be indistinguishable from a normally
 * mounted one — it just lives somewhere else in the DOM. Every part of that had unit tests and
 * NOT ONE application used it, here or in the docs site. This is the first thing that renders a
 * portal through a real build, a real server and a real hydration.
 *
 * Three claims, and each fails differently:
 *
 * - **Served.** The container is outside `#app`, so it exists only if the server collected the
 *   block and the shell had a `<!--portals-->` to put it in. Dropping it renders a page that looks
 *   perfect and builds the subtree a second time in the browser.
 * - **Adopted.** The nodes are compared by IDENTITY before and after hydration. A rebuild is not a
 *   crash — the page looks the same — so nothing but identity can tell the difference.
 * - **Restored.** `#notice-origin` is written by a SERVER-only `@created`. A component that was
 *   rebuilt rather than hydrated shows `client`, the value the field initialises to.
 */
async function checkPortal() {
  const { JSDOM } = await import("jsdom");
  const code = await readFile(join(root, "dist/client/assets/client.js"), "utf8");

  const served = await httpGet(`http://localhost:${PORT}/`);
  const page = await served.text();

  if (!page.includes('data-ramonda-portal-target="notices"')) {
    fail("the served page has no container for the `notices` portal target");
  }
  // Outside the app root, which is the entire reason to aim at a named target.
  if (page.indexOf("data-ramonda-portal-target") < page.indexOf('<div id="app">')) {
    fail("the portal container was emitted before the app root");
  }
  const servedOrigin = /<li id="notice-origin">([^<]*)</.exec(page)?.[1];
  if (servedOrigin !== "server") fail(`the server rendered the portal with origin=${servedOrigin}, expected server`);

  const dom = new JSDOM(page, {
    url: `http://localhost:${PORT}/`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.fetch = async () => new window.Response("{}", { status: 200 });

  // Held as NODES, never as attributes: the diff removes attributes it does not know about, so a
  // marker would read as a replacement even where the element was adopted.
  const doc = window.document;
  const serverContainer = doc.querySelector("[data-ramonda-portal-target]");
  const serverList = doc.querySelector("#notices");
  const serverRows = [...doc.querySelectorAll(".notice")];
  if (serverRows.length !== 2) fail(`the server rendered ${serverRows.length} portal row(s), expected 2`);

  window.eval(code);
  await new Promise((resolve) => setTimeout(resolve, 300));

  if (doc.querySelector("[data-ramonda-portal-target]") !== serverContainer) {
    fail("hydration replaced the portal's container instead of adopting it");
  }
  if (doc.querySelector("#notices") !== serverList) {
    fail("hydration rebuilt the portalled subtree instead of adopting it");
  }
  const liveRows = [...doc.querySelectorAll(".notice")];
  if (liveRows.length !== serverRows.length || liveRows.some((row, i) => row !== serverRows[i])) {
    fail("hydration rebuilt the list() rows inside the portal instead of adopting them");
  }
  const origin = doc.querySelector("#notice-origin")?.textContent;
  if (origin !== "server") {
    fail(`the portalled component was rebuilt, not restored: origin=${origin} after hydration (expected server)`);
  }

  // The question `list()` exists to answer: does a reorder MOVE the rows or rewrite them?
  //
  // A positional fallback produces identical TEXT, which is exactly what makes it a trap — so this
  // compares the row ELEMENTS by identity. Same nodes in the opposite order is a region reconcile;
  // same nodes in the same order with swapped text is the fallback, and anything else is a rebuild.
  const before = [...doc.querySelectorAll(".notice")];
  const textBefore = before.map((row) => row.textContent);
  doc.querySelector("#reverse-notices").dispatchEvent(new window.Event("click", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 100));

  const after = [...doc.querySelectorAll(".notice")];
  const textAfter = after.map((row) => row.textContent);
  if (JSON.stringify(textAfter) !== JSON.stringify([...textBefore].reverse())) {
    fail(`the reorder did not reverse the portal's rows: ${textBefore} then ${textAfter}`);
  }
  if (after.length !== before.length || !after.every((row) => before.includes(row))) {
    fail("the reorder REBUILT the portal's rows instead of moving them — list() degraded to a positional pass");
  }
  if (after[0] === before[0]) {
    fail("the rows kept their positions after a reverse, so nothing moved");
  }

  return { rows: after.length };
}

const panel = await checkPanel();
const editor = await checkEditorEndpoint();

/**
 * What a component IS in the DOM, asked of a real server and a real parse.
 *
 * A component owns a RANGE of nodes rather than one element, and the whole of that claim is only
 * checkable here: the server has to say where each range begins and ends in TEXT, the parser has to
 * leave what it says alone, and hydration has to take it back out again. A jsdom unit test can check
 * the last step; it cannot check that the HTML survives being served and parsed.
 *
 * Four things, and each of them was impossible or wrong before:
 *
 * - two `<td>` from one component sit INSIDE the `<tr>`. An element there is foster-parented out in
 *   front of the whole table by the parser, which is what `RMD010` existed to refuse.
 * - a component that renders nothing is an EMPTY marker pair — its whole footprint.
 * - after hydration there is not one comment left under `#app`, so the page holds exactly what a
 *   client-side render would have produced.
 * - the nodes are ADOPTED, not rebuilt: the deep `<code>` is the same object after hydration.
 */
async function checkNesting() {
  const { JSDOM } = await import("jsdom");
  const code = await readFile(join(root, "dist/client/assets/client.js"), "utf8");

  const served = await fetch(`http://localhost:${PORT}/nesting`);
  if (!served.ok) fail(`GET /nesting answered ${served.status}`);
  const page = await served.text();

  // Two cells from one component, inside the row, with nothing of the framework's between them.
  const row = /<tr class="person"><!--c(\d+)-->(.*?)<!--\/c\1--><\/tr>/.exec(page);
  if (!row) fail("the served row is not a marker pair wrapping the cells — the parser moved something");
  if (!/^<td class="name">.*<\/td><td class="age">\d+<\/td>$/.test(row[2])) {
    fail(`the row's block is ${row[2]}, expected exactly the two cells`);
  }

  // A component that renders nothing: an empty pair, and that is all of it.
  if (!/<!--c(\d+)--><!--\/c\1-->/.test(page)) {
    fail("no empty marker pair in the served page, so a component that renders nothing left no trace");
  }

  const dom = new JSDOM(page, {
    url: `http://localhost:${PORT}/nesting`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const doc = window.document;

  const servedDeep = doc.querySelector("#deep");
  if (!servedDeep) fail("the server did not render the deeply nested component");

  window.eval(code);
  await new Promise((resolve) => setTimeout(resolve, 300));

  if (doc.querySelector("#deep") !== servedDeep) {
    fail("hydration rebuilt the deeply nested component instead of adopting its element");
  }

  const app = doc.getElementById("app");
  const walker = doc.createTreeWalker(app, 128 /* SHOW_COMMENT */);
  let left = 0;
  while (walker.nextNode()) left++;
  if (left !== 0)
    fail(`${left} of the server's markers survived hydration — the page is not what a client render makes`);

  const cellsOf = () => [...doc.querySelectorAll("tr.person")].map((tr) => tr.children.length);
  if (JSON.stringify(cellsOf()) !== JSON.stringify([2, 2])) {
    fail(`each row must hold exactly its two cells, found ${JSON.stringify(cellsOf())}`);
  }

  const panels = () => doc.querySelectorAll("p.panel-line").length;
  if (panels() !== 2) fail(`expected two panels before the toggle, found ${panels()}`);

  const flip = doc.querySelector("#flip");
  flip.dispatchEvent(new window.Event("click", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (panels() !== 0) fail(`hiding left ${panels()} panel(s) behind`);

  flip.dispatchEvent(new window.Event("click", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (panels() !== 2) fail(`showing them again produced ${panels()} panel(s)`);

  const rows = cellsOf().length;

  // Closed, because this page mounts a component with a live `@interval` — a timer inside jsdom
  // keeps Node's event loop alive and the run would never end. Read what is being reported first:
  // a closed window answers `0` for everything, which reads as a passing check that measured nothing.
  window.close();

  return { rows };
}

const form = await checkForm();
const portal = await checkPortal();
const nesting = await checkNesting();
await checkModes();

stop();
console.log(
  `[smoke] the server rendered / with ${html.length} bytes, and all ${checks.length} checks passed\n` +
    `[smoke] the panel listed ${panel.rows} components, edited ${panel.editing}, ` +
    `and the QUERY tab listed ${panel.queryRows} row(s)\n` +
    `[smoke] the endpoint resolved ${editor.source} ` +
    `(${editor.opened ? "and opened it" : "no editor on this machine, which is not this test's business"}), ` +
    `and refused a path that does not exist\n` +
    `[smoke] /signup rendered ${form.inputs} named inputs, hydration adopted them, ` +
    `and the row ids survived a splice (${form.rowids})\n` +
    `[smoke] a portal into a named target was served outside #app, adopted on hydration, kept the ` +
    `state the server gave it, and MOVED its ${portal.rows} list() rows on a reorder\n` +
    `[smoke] /nesting served its ${nesting.rows} rows as marker pairs inside the <tr>, hydration ` +
    `adopted the markup and removed every marker, and the toggle takes both panels out and back\n` +
    `[smoke] all three render modes answered: static, dynamic, and ISR through a background rebake`,
);
