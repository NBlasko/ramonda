import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { checkProject } from "../check";
import { fileMayHoldABlock } from "../compiler/scan";

/**
 * Every consumer asks ONE question about which files can hold a block.
 *
 * The editor plugin, the CLI check, the Vite plugin and the esbuild plugin each used to decide it
 * their own way, and adding a `.d.ts` exclusion to one of them was enough to make the build and the
 * editor disagree: `export const card = @@( colour: red; )` written in a declaration file was two
 * reports from `ramonda-css` and nothing at all in the editor. A green editor over a red build is
 * the worst shape this repository has.
 *
 * So the question lives in `scan.ts` and this asserts that nothing has gone back to asking it
 * privately. A regex of its own in any of the four is what this catches.
 */
const made: string[] = [];
afterAll(() => {
  for (const one of made) rmSync(one, { recursive: true, force: true });
});

describe("which files can hold a block", () => {
  test.each([
    ["src/Card.tsx", true],
    ["src/theme.ts", true],
    ["src/legacy.jsx", true],
    ["src/legacy.js", true],
    ["src/module.mts", true],
    ["src/module.cjs", true],
    // A declaration file declares types, and TypeScript allows no initialiser in an ambient
    // context — so there is nowhere in one for a block to be written.
    ["src/vendor.d.ts", false],
    ["node_modules/typescript/lib/lib.es2022.d.ts", false],
    ["src/generated.d.mts", false],
    ["src/generated.d.cts", false],
    // Not source at all.
    ["src/styles.css", false],
    ["package.json", false],
    ["README.md", false],
  ])("%s → %s", (fileName, answer) => {
    expect(fileMayHoldABlock(fileName)).toBe(answer);
  });

  /** The one that is easy to get wrong: a name that merely CONTAINS the letters. */
  test("a file whose name only looks like a declaration is still source", () => {
    expect(fileMayHoldABlock("src/d.ts")).toBe(true);
    expect(fileMayHoldABlock("src/index.dts.ts")).toBe(true);
  });

  /**
   * The behaviour the whole thing is for: a block in a declaration file is not read as CSS by the
   * CLI either, only by the editor.
   *
   * This is the test that caught the divergence. The name test below cannot: leaving the import in
   * place while deleting the call passes it, which it did.
   *
   * **TypeScript's own complaint stays, and that is the right answer.** A declaration file allows no
   * initialiser, so `export const card = @@( … )` is not valid there — and it used to be transformed
   * away, which reported the CSS and hid the fact that the file could not exist. Now `tsc` says
   * `')' expected`, in the CLI and in the editor alike, which is the same thing both of them now say.
   */
  test("the CLI check does not read a declaration file as CSS", () => {
    const root = mkdtempSync(join(tmpdir(), "ramonda-dts-"));
    made.push(root);
    mkdirSync(join(root, "src"), { recursive: true });
    // Two faults a block anywhere else would be reported for.
    writeFileSync(join(root, "src", "vendor.d.ts"), "export const card = @@( colour: red; display: flexx; );\n");
    writeFileSync(join(root, "src", "plain.ts"), "export const nothing = 1;\n");
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ESNext",
          module: "ESNext",
          moduleResolution: "bundler",
          types: [],
          skipLibCheck: true,
        },
        include: ["src"],
      }),
    );

    const report = checkProject(join(root, "tsconfig.json"));

    const said = report.findings.filter((one) => one.file.endsWith("vendor.d.ts")).map((one) => one.message);

    // Nothing about the CSS — no `colour`, no `flexx`, no rule id.
    expect(said.filter((one) => /colour|flexx|unknown-property|unknown-value/.test(one))).toEqual([]);
    // And TypeScript still refuses the file, which is what it is: not a declaration file.
    expect(said.join(" ")).toContain("expected");
  });

  /** And nobody keeps a copy of the question. */
  test.each([
    "../../css/src/plugin.ts",
    "../../css/src/check.ts",
    "../../css/src/vite.ts",
    "../../css/src/esbuild.ts",
    // Another package, and the one the last sweep missed: it bundles this compiler and overlays
    // every file a `ts.CompilerHost` is handed.
    "../../check/src/analyze.ts",
  ])("%s does not ask it privately", async (file) => {
    const { readFileSync } = await import("node:fs");
    const { dirname, resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", file.replace("../../", "")),
      "utf8",
    );

    /**
     * A CALL, not the name. The first version asserted the name and passed while the call had been
     * deleted and only the import was left — twice, on two different consumers.
     */
    expect(source).toMatch(/fileMayHoldABlock\(/);

    /**
     * A regex of its own is allowed in exactly one shape: an esbuild `onLoad` filter, which esbuild
     * requires to be a RegExp and cannot take a function. Both bundler adapters set one up — the
     * esbuild plugin, and the scanner Vite runs during dependency discovery — and both call the
     * predicate as their first line inside it.
     */
    const copies = source.match(/\/\\\.\[cm\]\?\[jt\]sx\?\$\//g) ?? [];
    const allowed = file.endsWith("esbuild.ts") || file.endsWith("vite.ts") ? 1 : 0;
    expect(copies.length).toBeLessThanOrEqual(allowed);
    for (const _ of copies) expect(source).toMatch(/filter: [^}]*\}[\s\S]{0,240}?fileMayHoldABlock/);
  });
});
