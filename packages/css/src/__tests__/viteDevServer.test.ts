import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository, whose `node_modules` a temp project resolves the package through. */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
import { createServer, type ViteDevServer } from "vite";
import { afterEach, expect, test } from "vitest";
import { ramondaCss } from "../vite";

/**
 * A real dev server, saving a file — the only thing that can say what an author SEES after a save.
 *
 * `vite.test.ts` calls the hooks directly and `viteBuild.test.ts` runs a production build. Neither
 * can ask this, because the fault is an ordering one and it only exists while a server is running:
 * a save invalidates the file and its stylesheet, Vite sends both in one update payload, and the
 * client fetches them together. The stylesheet is a string out of a Map and the file has to run the
 * compiler, so the stylesheet always answers first — and, before `handleHotUpdate` existed, it
 * answered out of a sheet still holding the previous save's blocks. Measured here, three saves in a
 * row, every one of them exactly one save behind.
 */

const servers: ViteDevServer[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const one of servers.splice(0)) await one.close();
  for (const one of roots.splice(0)) rmSync(one, { recursive: true, force: true });
});

/** The classes the emitted JavaScript names, and the classes the stylesheet defines. */
const named = (code: string) => [...code.matchAll(/"(r-[\w-]+)"/g)].map((each) => each[1]);
const defined = (code: string) => [...code.matchAll(/\.(r-[\w-]+)/g)].map((each) => each[1]);

async function serve(source: string, config?: string, alongside?: string) {
  /**
   * `realpathSync`, and it had to be measured: on macOS a temporary directory is `/var/…`, which is
   * a symlink to `/private/var/…`. Vite resolves the id through the real path and then checks it
   * against `server.fs.allow`, which still holds the symlinked root — so nothing under it is allowed
   * to load and every request comes back *Does the file exist?* about a file that does.
   */
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ramonda-css-hmr-")));
  roots.push(root);
  /**
   * A config's `import { kind } from "@ramonda/css/config"` is RUN, so it has to resolve.
   *
   * It used to resolve through `NODE_PATH`, which pnpm points at its hoisted `.pnpm/node_modules` —
   * an artefact of one machine's install history that a clean checkout does not have. The
   * REPOSITORY's, not the package's: a package does not contain itself.
   */
  symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"));
  mkdirSync(join(root, "src"), { recursive: true });
  const runtime = join(root, "runtime.js");
  writeFileSync(runtime, "export const block = (...a) => a;\nexport const merge = (...a) => a;\n");
  const file = join(root, "src", "main.ts");
  writeFileSync(file, source);
  const configPath = join(root, "ramonda.css.ts");
  if (config !== undefined) writeFileSync(configPath, config);
  const second = join(root, "src", "second.ts");
  if (alongside !== undefined) writeFileSync(second, alongside);

  const server = await createServer({
    root,
    logLevel: "silent",
    // The real watcher OFF, and that is what makes this test deterministic rather than nearly so.
    // Measured: chokidar fires its own event for the same write, so `sent.length` grew from a
    // payload that belonged to the PREVIOUS save and the fetch ran before this one was handled.
    // The trace showed 3 and 4 payloads where the test had made 2 and 3 saves. Nothing here is
    // about chokidar noticing a file; the change event is emitted below, which is the input the
    // plugin is under test for.
    server: { middlewareMode: true, ws: false, watch: null },
    plugins: [ramondaCss({ runtime }) as never],
  });
  servers.push(server);

  /** Every update payload the server would have sent, so a save can be waited for rather than slept on. */
  const sent: { type: string }[] = [];
  (server.hot as unknown as { send: (payload: { type: string }) => void }).send = (payload) => {
    sent.push(payload);
  };

  /**
   * A save, and the wait for the server to have finished handling it.
   *
   * **One save is one payload, because the real watcher is off** — see `createServer` above. It was
   * not, and this waited for `sent.length` to grow by any amount: chokidar fired its own event for
   * the same write, so the wait could be satisfied by a payload belonging to the PREVIOUS save and
   * the fetch ran before this one had been handled. Measured over repeated whole-suite runs, it
   * failed about one run in four, only under the load of the other files — and a trace showed 3 and
   * 4 payloads where the test had made 2 and 3 saves.
   *
   * The first repair was a longer wait, which is what one reaches for when the cause is a guess. It
   * made the window smaller and left the race. Vitest's own timeout is what should end a hang.
   */
  async function save(next: string) {
    const before = sent.length;
    writeFileSync(file, next);
    server.watcher.emit("change", file);
    for (let waited = 0; sent.length === before && waited < 30_000; waited += 10) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(sent.length).toBeGreaterThan(before);
  }

  /**
   * A cold load: the file, then its stylesheet. That is the real order — the client learns the
   * stylesheet exists only from the import the transform appended, so it cannot ask for it first.
   */
  async function firstLoad() {
    const js = await server.transformRequest("/src/main.ts");
    const css = await server.transformRequest("/src/main.ts?ramonda-css.css");
    return { css: defined(css?.code ?? ""), js: named(js?.code ?? "") };
  }

  /**
   * After a save, both modules are already in the graph and the client fetches them TOGETHER — with
   * the stylesheet answering first, which is the order the race actually produces.
   */
  async function fetchBoth() {
    const [css, js] = await Promise.all([
      server.transformRequest("/src/main.ts?ramonda-css.css"),
      server.transformRequest("/src/main.ts"),
    ]);
    return { css: defined(css?.code ?? ""), js: named(js?.code ?? "") };
  }

  /**
   * A save of `ramonda.css.ts`, through the WATCHER — so the server's own plugin instance handles
   * it, which is the whole point.
   *
   * Calling `ramondaCss(…).handleHotUpdate` directly was the first version and it measured nothing:
   * a fresh plugin has an empty memo, so it regenerated the stylesheet (which is filesystem state)
   * and invalidated no module (which is instance state). The test passed the half it could not have
   * failed and failed the half that works.
   */
  async function saveConfig(next: string) {
    writeFileSync(configPath, next);
    server.watcher.emit("change", configPath);
    // The config path is not in the module graph, so no payload is sent and there is nothing to
    // wait for by counting one. The hook is awaited by the server before it returns from the event.
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  /** What `css-system/variables.css` currently says one variable is. */
  const variable = () => {
    const sheet = join(root, "css-system", "variables.css");
    if (!existsSync(sheet)) return "(no file)";
    return /--space-gutter:\s*([^;]+)/.exec(readFileSync(sheet, "utf8"))?.[1] ?? "(not in it)";
  };

  return { save, saveConfig, variable, firstLoad, fetchBoth, server, second };
}

const withDisplay = (display: string) =>
  `const a = @@( display: ${display}; );\nexport default a;\nif (import.meta.hot) import.meta.hot.accept();\n`;

test("the stylesheet a save serves defines the class that save's JavaScript names", async () => {
  const { save, firstLoad, fetchBoth } = await serve(withDisplay("flex"));

  const first = await firstLoad();
  expect(first.js).toEqual(first.css);
  expect(first.js).toEqual(["r-disp-flex"]);

  // Three in a row, because being one behind looks identical to being right on the first save.
  for (const display of ["grid", "block", "inline-flex"]) {
    await save(withDisplay(display));
    const both = await fetchBoth();
    expect(both.css).toEqual(both.js);
    expect(both.js).toEqual([`r-disp-${display}`]);
  }
});

test("a file that loses its last block loses its rules on the same save", async () => {
  const { save, firstLoad, fetchBoth } = await serve(withDisplay("flex"));
  expect((await firstLoad()).css).toEqual(["r-disp-flex"]);

  await save(`export default 1;\nif (import.meta.hot) import.meta.hot.accept();\n`);
  const both = await fetchBoth();
  expect(both.js).toEqual([]);
  expect(both.css).toEqual([]);
});

test("a save that cannot compile is not reported by the watcher, and is reported by the transform", async () => {
  const { save, firstLoad, server } = await serve(withDisplay("flex"));
  await firstLoad();

  // The hot update swallows it: this is not where an author should meet a diagnostic.
  await expect(save(`const a = @@( display: ; );\nexport default a;\n`)).resolves.toBeUndefined();

  // The transform is, at the author's own line.
  await expect(server.transformRequest("/src/main.ts")).rejects.toThrow();
});

/**
 * SAVING `ramonda.css.ts` while the server is running.
 *
 * The config is the file the playground's own copy calls *here to be CHANGED* — a variable's value,
 * a unit list, a property switched off. Measured, saving it did NOTHING: `recompile` takes only
 * files that hold a block, and a config holds none, so it returned at the first line.
 *
 * Two halves, and the second is the sharp one:
 *
 * - every already-compiled file keeps the rules the OLD config gave it, so a narrowed `units` or a
 *   newly forbidden property is not enforced until each file is touched by hand;
 * - `css-system/variables.css` is written by codegen at `buildStart` and never again, so a design
 *   token changed from `16px` to `40px` still served `16px`. That file is a plain stylesheet the
 *   project imports once — nothing else was ever going to regenerate it.
 *
 * Both are invisible: the page is simply wrong, and a restart is the only thing that fixes it.
 */
test("saving the config regenerates the variables stylesheet", async () => {
  const gutter = (value: string) =>
    `import { kind } from "@ramonda/css/config";\n` +
    `export default { variables: { space: kind("length", { gutter: "${value}" }) } };\n`;

  const { saveConfig, firstLoad, variable } = await serve(withDisplay("flex"), gutter("16px"));
  await firstLoad();
  expect(variable()).toBe("16px");

  await saveConfig(gutter("40px"));
  expect(variable()).toBe("40px");
});

test("and every file already compiled is checked against the new config", async () => {
  const units = (unit: string) => `export default { units: { length: ["${unit}"] } };\n`;
  const block = `const a = @@( padding: 2rem; );\nexport default a;\nif (import.meta.hot) import.meta.hot.accept();\n`;

  const { saveConfig, firstLoad, server } = await serve(block, units("rem"));
  // It compiles under the config it was written for, which is the control.
  expect((await firstLoad()).js).toEqual(["r-p-2rem"]);

  await saveConfig(units("px"));

  // `2rem` is not permitted any more, and the author is told at their own line rather than on a
  // page that quietly kept the old rule.
  await expect(server.transformRequest("/src/main.ts")).rejects.toThrow(/unit-not-allowed/);
});

test("and a config that is saved with a fault in it does not take the server down", async () => {
  const { saveConfig, firstLoad } = await serve(withDisplay("flex"), `export default { units: { length: ["px"] } };\n`);
  await firstLoad();

  // Half-typed, which is what a config looks like for most of the time it is being edited.
  await expect(saveConfig(`export default { units: {{{ };\n`)).resolves.toBeUndefined();
});

/**
 * TWO files, which every test above is not — each of them saves one file and asks about it.
 *
 * A shared atom is where review passes 10 and 11 both found a fault: two files naming
 * `display: flex` mean ONE rule, and what happens to it when one of them stops naming it is not a
 * question a single-file test can ask. It is right, and these are here so it stays right.
 */
test("a file keeps a rule another file has stopped naming", async () => {
  const { server, save, second } = await serve(
    `const a = @@( display: flex; color: red; );\nexport default a;\n`,
    undefined,
    `const b = @@( display: flex; color: blue; );\nexport default b;\n`,
  );

  /**
   * The JS FIRST, then its stylesheet — and that order is not a convenience.
   *
   * The transform appends `import "<absolute path>?ramonda-css.css"`, so a client learns the
   * stylesheet's URL only by reading the JavaScript. Asking for the URL before the JS has ever been
   * transformed hits `load` with an id Vite has not resolved to a path, and the sheet has nothing
   * under that key — which measured as an empty stylesheet and looked exactly like a bug. It is a
   * request a browser cannot make.
   */
  const ask = async (name: string) => {
    await server.transformRequest(`/src/${name}`);
    return defined((await server.transformRequest(`/src/${name}?ramonda-css.css`))?.code ?? "");
  };

  expect(await ask("main.ts")).toEqual(["r-disp-flex", "r-c-red"]);
  expect(await ask("second.ts")).toEqual(["r-disp-flex", "r-c-blue"]);

  // The first file stops using the shared atom. The second still needs it.
  await save(`const a = @@( display: grid; color: red; );\nexport default a;\n`);
  expect(await ask("main.ts")).toEqual(["r-disp-grid", "r-c-red"]);
  expect(await ask("second.ts")).toEqual(["r-disp-flex", "r-c-blue"]);

  // And it survives the first file losing its block altogether.
  await save(`export default 1;\n`);
  expect(await ask("main.ts")).toEqual([]);
  expect(await ask("second.ts")).toEqual(["r-disp-flex", "r-c-blue"]);
  void second;
});

/**
 * A long editing session, which is the shape a stale rule hides in.
 *
 * Every save makes a new atom and abandons the last one, and a page still carrying `padding: 0px`
 * from forty saves ago is the kind of wrong nobody suspects the tool for.
 *
 * **What this asserts is what a file SERVES**, which is `byFile` being replaced on each save rather
 * than added to — measured by breaking that line, which fails this and the test above. It does NOT
 * assert that the sheet's own `rules` map is bounded: breaking the withdraw loop leaves dead entries
 * there and every file still serves the right CSS. That is a memory question and it needs the sheet
 * asked directly, which `sheet.test.ts` is the place for.
 */
test("fifty saves leave a file serving its own two rules and no more", async () => {
  const { server, save, fetchBoth, firstLoad } = await serve(
    `const a = @@( padding: 0px; color: red; );\nexport default a;\nif (import.meta.hot) import.meta.hot.accept();\n`,
  );
  await firstLoad();

  for (let n = 1; n <= 50; n++) {
    await save(
      `const a = @@( padding: ${n}px; color: red; );\nexport default a;\nif (import.meta.hot) import.meta.hot.accept();\n`,
    );
    await server.transformRequest("/src/main.ts");
  }

  const { css } = await fetchBoth();
  expect(css).toEqual(["r-p-50px", "r-c-red"]);
});

test("a file that gains its first block is picked up", async () => {
  const { save, firstLoad, server } = await serve(`export default 1;\n`);

  /**
   * The JavaScript ONLY, because a file with no block has no stylesheet to ask for.
   *
   * `firstLoad` asks for both, and asking for a stylesheet nothing imports is a request a browser
   * cannot make — the URL is only ever learnt from the `import` the transform appends. Measured, it
   * creates the module empty and Vite caches that, so the save afterwards looked like it had been
   * missed. The fault was in the asking.
   */
  expect(named((await server.transformRequest("/src/main.ts"))?.code ?? "")).toEqual([]);

  await save(`const a = @@( color: green; );\nexport default a;\nif (import.meta.hot) import.meta.hot.accept();\n`);
  // `firstLoad`'s order, because that is what a client does here: it has never seen this file's
  // stylesheet and can only learn the URL from the JavaScript it is about to fetch.
  const both = await firstLoad();
  expect(both.js).toEqual(["r-c-green"]);
  expect(both.css).toEqual(["r-c-green"]);
});

test("a change to a file that is not source is left alone", async () => {
  const { server } = await serve(withDisplay("flex"));
  const hot = ramondaCss().handleHotUpdate;
  await expect(
    hot.call(undefined, { file: join(server.config.root, "src", "styles.css"), read: () => "" }),
  ).resolves.toBeUndefined();
});
