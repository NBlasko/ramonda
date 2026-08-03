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
      const response = await fetch(`http://localhost:${PORT}/`);
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
      const answer = await fetch(url.startsWith("http") ? url : `http://localhost:${PORT}${url}`, init);
      if (url.includes("__open-in-editor")) editorCalls.push({ url, status: answer.status });
      return answer;
    }
    return new window.Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };

  window.eval(code);
  await new Promise((resolve) => setTimeout(resolve, 500));

  const panel = window.document.querySelector("ramonda-devtools");
  if (!panel) fail("the client did not mount the devtools panel");
  if (typeof window.__RAMONDA_WRITE__ !== "function") fail("core did not install the devtools write bridge");

  panel.toggle();
  panel.shadowRoot.querySelector('.tab[data-tab="components"]').dispatchEvent(new window.Event("click"));
  await new Promise((resolve) => setTimeout(resolve, 200));

  const rows = panel.shadowRoot.querySelectorAll(".comp-summary").length;
  if (rows < 5) fail(`the panel listed ${rows} components, so the tree did not come through`);

  // 1. A pencil, on a row that really exists in this app, and it has to open an editor.
  const pencil = panel.shadowRoot.querySelector("[data-edit-node]");
  if (!pencil) fail("no state is editable anywhere in the tree, which cannot be right");
  pencil.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  if (!panel.shadowRoot.querySelector(".edit-input")) {
    fail(`the edit pencil for ${pencil.dataset.editKey} opened nothing (vid: ${pencil.dataset.editVid})`);
  }
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
  await new Promise((resolve) => setTimeout(resolve, 500));

  if (editorCalls.length === 0) fail("clicking the editor button asked the server for nothing");

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
  const answer = await fetch(`http://localhost:${PORT}/__open-in-editor?${query}`);
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
  const refusal = await fetch(`http://localhost:${PORT}/__open-in-editor?${bogus}`);
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

const panel = await checkPanel();
const editor = await checkEditorEndpoint();
const form = await checkForm();

stop();
console.log(
  `[smoke] the server rendered / with ${html.length} bytes, and all ${checks.length} checks passed\n` +
    `[smoke] the panel listed ${panel.rows} components and edited ${panel.editing}\n` +
    `[smoke] the endpoint resolved ${editor.source} ` +
    `(${editor.opened ? "and opened it" : "no editor on this machine, which is not this test's business"}), ` +
    `and refused a path that does not exist\n` +
    `[smoke] /signup rendered ${form.inputs} named inputs, hydration adopted them, ` +
    `and the row ids survived a splice (${form.rowids})`,
);
