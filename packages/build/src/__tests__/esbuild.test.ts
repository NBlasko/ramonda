import { describe, expect, test } from "vitest";
import { build as esbuild } from "esbuild";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ramonda, ramondaOptions } from "../esbuild";

/**
 * esbuild is where this actually went wrong, and the reason is one line of its documentation: the
 * default target is `esnext`. A build that says nothing about a target gets the one value that
 * leaves the decorators in — so "forgot to configure it" and "configured it wrongly" are the same
 * bug, and neither of them says a word at build time.
 */

const SOURCE =
  `function Host(t: string) { return (v: unknown) => v; }\n` +
  `@Host("div") export class A { x = 1 }\n` +
  `export const used = new A();\n`;

async function bundleWith(options: Parameters<typeof esbuild>[0]) {
  const dir = await mkdtemp(join(tmpdir(), "ramonda-build-esbuild-"));
  try {
    const entry = join(dir, "entry.ts");
    await writeFile(entry, SOURCE);
    const result = await esbuild({ ...options, entryPoints: [entry], bundle: true, format: "esm", write: false });
    const code = result.outputFiles.map((file) => file.text).join("\n");

    // `node --check` rather than a search for `@Host`, because the emitted spelling of a surviving
    // decorator is not the one that was written and the question is only ever whether it parses.
    const emitted = join(dir, "out.mjs");
    await writeFile(emitted, code);
    return await new Promise<boolean>((resolve) => execFile(process.execPath, ["--check", emitted], (e) => resolve(!e)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("the options object", () => {
  test("spreading it into a build is enough", async () => {
    await expect(bundleWith({ ...ramondaOptions })).resolves.toBe(true);
  });

  test("without it, the same build emits something no engine can read — the fault, reproduced", async () => {
    await expect(bundleWith({})).resolves.toBe(false);
  });
});

describe("the plugin", () => {
  test("fills in what the build did not set", async () => {
    await expect(bundleWith({ plugins: [ramonda()] })).resolves.toBe(true);
  });

  test("refuses a target that leaves them in, rather than overriding it", async () => {
    await expect(bundleWith({ target: "esnext", plugins: [ramonda()] })).rejects.toThrow(/decorator/i);
  });

  test("leaves a target that already works", async () => {
    let seen: unknown;
    const parsed = await bundleWith({
      target: "es2020",
      plugins: [ramonda(), { name: "spy", setup: (build) => void (seen = build.initialOptions.target) }],
    });

    expect(seen).toBe("es2020");
    expect(parsed).toBe(true);
  });
});
