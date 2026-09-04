import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The build-output guard, tested as the instrument it is.
 *
 * Every package's `build` ends with it, and so does the `build` of every project
 * scaffolded with `npm create ramonda` — which is why it ships from here rather
 * than from a package private to this workspace.
 *
 * Why it exists at all: TC39 decorators are not parseable JavaScript in any
 * engine, so a build that fails to strip them emits a file that dies on load
 * with `SyntaxError`. That shipped once, and nothing checked it.
 *
 * **The pipeline that produced that bug no longer reproduces it.** Re-measured
 * on the pinned toolchain: building `apps/playground-core` with Vite 7.3.1 and
 * `esbuild.jsxInject` REMOVED — the documented trigger — still emits output that
 * parses. That makes a test against the SYMPTOM, rather than against the
 * pipeline, the only honest way to keep the guard covered.
 */

const GUARD = join(dirname(fileURLToPath(import.meta.url)), "../../check-bundle.mjs");

function runGuard(...args: string[]): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [GUARD, ...args], (error, stdout, stderr) => {
      const code =
        error && typeof (error as { code?: unknown }).code === "number"
          ? (error as { code: number }).code
          : error
            ? 1
            : 0;
      resolve({ code, output: `${stdout}${stderr}` });
    });
  });
}

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ramonda-build-guard-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("check-bundle", () => {
  test("passes a bundle that parses", async () => {
    const good = join(dir, "good");
    await mkdir(good, { recursive: true });
    await writeFile(join(good, "index.js"), "export const a = 1;\nclass B {}\n");

    const { code, output } = await runGuard(good);
    expect(code).toBe(0);
    expect(output).toContain("1 emitted file(s) parse");
  });

  test("fails on a surviving decorator — the bug it was written for", async () => {
    const bad = join(dir, "bad");
    await mkdir(bad, { recursive: true });
    // The shape found in the shipped bundle: a decorator that came through
    // minification intact.
    await writeFile(join(bad, "chunk.js"), "@G class q { isFetched = 0 }\nexport { q };\n");

    const { code, output } = await runGuard(bad);
    expect(code).toBe(1);
    expect(output).toContain("do not parse");
    expect(output).toContain("chunk.js");
  });

  test("does NOT flag decorator text inside a string — why it parses instead of grepping", async () => {
    // Measured on the real thing, `packages/core/dist/index.js` on 2026-09-04: five occurrences of
    // `@Name(` survive into the shipped bundle — `@StableProps("key")` inside a fix message, and
    // `@interval("1s")` inside a comment that shows what throws. A grep for decorator syntax calls
    // that perfectly good bundle broken; a parser does not care what is in a string.
    //
    // The measurement used to be about `@Host`, which core's diagnostics no longer mention because
    // the decorator is gone. The claim held while the names did not.
    const stringy = join(dir, "stringy");
    await mkdir(stringy, { recursive: true });
    await writeFile(
      join(stringy, "diagnostics.js"),
      'export const fix = `Name the set once: @StableProps("key") merges along the class chain.`;\n' +
        "export const other = { suggestion: '@onWindow(\"resize\")' };\n",
    );

    const { code, output } = await runGuard(stringy);
    expect(code).toBe(0);
    expect(output).toContain("parse");
  });

  test("an ESM bundle under a CommonJS package.json is not called broken", async () => {
    // A bundler emits ES modules into `dist` whatever the surrounding
    // package.json declares, so `"type": "commonjs"` next to ESM output is an
    // ordinary arrangement, not a mistake.
    //
    // `node --check` reads a `.js` file as a SCRIPT there, and reported the
    // build broken with `Cannot use import statement outside a module` — while
    // suggesting the cause was an unstripped decorator. A guard that accuses a
    // correct build of the one bug it exists to find is worse than no guard.
    //
    // The same accusation reached projects with NO `type` field at all on Node
    // 22.0–22.6, where module detection had not landed yet. That window is below
    // this package's `engines` floor; this arrangement is not, on any version.
    const app = join(dir, "cjs-app");
    await mkdir(join(app, "dist"), { recursive: true });
    await writeFile(join(app, "package.json"), '{"name":"an-app","type":"commonjs"}\n');
    await writeFile(
      join(app, "dist", "index.js"),
      'import { render } from "./chunk.js";\nexport const app = render();\n',
    );

    const { code, output } = await runGuard(join(app, "dist"));
    expect(code).toBe(0);
    expect(output).toContain("1 emitted file(s) parse");
  });

  test("reading a file as a module does not hide a decorator in it", async () => {
    // The guard against the fix above: a second parse that accepts anything
    // would buy the false pass back at full price. A decorator is unparseable
    // as a module too, so the file this tool was written for still fails.
    const app = join(dir, "cjs-app-bad");
    await mkdir(join(app, "dist"), { recursive: true });
    await writeFile(join(app, "package.json"), '{"name":"an-app","type":"commonjs"}\n');
    await writeFile(join(app, "dist", "chunk.js"), "@G class q { isFetched = 0 }\nexport { q };\n");

    const { code, output } = await runGuard(join(app, "dist"));
    expect(code).toBe(1);
    expect(output).toContain("do not parse");
    expect(output).toContain("chunk.js");
  });

  test("a build that emitted nothing is a failure, not a pass", async () => {
    // The same shape as the bug: something silently produced no output, and a
    // check that reported success would be worse than no check.
    const empty = join(dir, "empty");
    await mkdir(empty, { recursive: true });

    const { code, output } = await runGuard(empty);
    expect(code).toBe(2);
    expect(output).toContain("no JavaScript found");
  });

  test("a missing directory fails rather than passing quietly", async () => {
    const { code } = await runGuard(join(dir, "does-not-exist"));
    expect(code).toBe(2);
  });
});
