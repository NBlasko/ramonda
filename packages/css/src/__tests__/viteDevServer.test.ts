import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

async function serve(source: string) {
  /**
   * `realpathSync`, and it had to be measured: on macOS a temporary directory is `/var/…`, which is
   * a symlink to `/private/var/…`. Vite resolves the id through the real path and then checks it
   * against `server.fs.allow`, which still holds the symlinked root — so nothing under it is allowed
   * to load and every request comes back *Does the file exist?* about a file that does.
   */
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ramonda-css-hmr-")));
  roots.push(root);
  mkdirSync(join(root, "src"), { recursive: true });
  const runtime = join(root, "runtime.js");
  writeFileSync(runtime, "export const block = (...a) => a;\nexport const merge = (...a) => a;\n");
  const file = join(root, "src", "main.ts");
  writeFileSync(file, source);

  const server = await createServer({
    root,
    logLevel: "silent",
    server: { middlewareMode: true, ws: false },
    plugins: [ramondaCss({ runtime }) as never],
  });
  servers.push(server);

  /** Every update payload the server would have sent, so a save can be waited for rather than slept on. */
  const sent: { type: string }[] = [];
  (server.hot as unknown as { send: (payload: { type: string }) => void }).send = (payload) => {
    sent.push(payload);
  };

  /** A save, and the wait for the server to have finished handling it. */
  async function save(next: string) {
    const before = sent.length;
    writeFileSync(file, next);
    server.watcher.emit("change", file);
    for (let waited = 0; sent.length === before && waited < 2000; waited += 10) {
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

  return { save, firstLoad, fetchBoth, server };
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

test("a change to a file that is not source is left alone", async () => {
  const { server } = await serve(withDisplay("flex"));
  const hot = ramondaCss().handleHotUpdate;
  await expect(
    hot.call(undefined, { file: join(server.config.root, "src", "styles.css"), read: () => "" }),
  ).resolves.toBeUndefined();
});
