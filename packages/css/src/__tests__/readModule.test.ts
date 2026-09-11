import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vitest";
import { readModule } from "../modules";

/**
 * The BUILD's module reader, measured against the resolver the EDITOR uses.
 *
 * ## Why it is checked against `ts.resolveModuleName` rather than against a list
 *
 * Two halves answer one question here, and they must agree: the editor resolves an import with
 * TypeScript's own resolver (`plugin.ts`), and the build guesses an extension. A generated custom
 * property's name is a hash of the declaring module's TEXT, so a disagreement is not a missing
 * feature — it is the editor showing a token resolved and the build refusing the same character,
 * or worse, the two producing different `--r-…` names for one token.
 *
 * It had no test at all, and a review found the gap it left: `./theme.js`, which is **mandatory**
 * under `moduleResolution: node16/nodenext`, resolved in the editor and missed in the build. The
 * comment above `EXTENSIONS` says "a miss costs nothing", and that is true of the build alone and
 * false of the pair.
 */
describe("the build's module reader", () => {
  const project = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), "ramonda-read-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(join(dir, "src", name.includes("/") ? name.slice(0, name.lastIndexOf("/")) : "."), {
        recursive: true,
      });
      writeFileSync(join(dir, "src", name), text);
    }
    return join(dir, "src", "Card.tsx");
  };

  /** What the editor would do with the same specifier, from the same file. */
  const editor = (specifier: string, from: string, kind: ts.ModuleResolutionKind) =>
    ts.resolveModuleName(
      specifier,
      from,
      { moduleResolution: kind },
      { fileExists: ts.sys.fileExists, readFile: ts.sys.readFile },
    ).resolvedModule?.resolvedFileName;

  const MARK = "export const accent = 1;\n";

  test.each([
    ["no extension, which is what a bundler project writes", "./theme", { "theme.ts": MARK }],
    ["a `.js` extension, which node16 and nodenext REQUIRE", "./theme.js", { "theme.ts": MARK }],
    ["the real extension, written out", "./theme.ts", { "theme.ts": MARK }],
    ["a `.tsx` module", "./theme", { "theme.tsx": MARK }],
    ["a directory with an index", "./theme", { "theme/index.ts": MARK }],
    ["a plain `.js` module", "./theme", { "theme.js": MARK }],
  ])("%s is read", (_what, specifier, files) => {
    const from = project(files);

    expect(readModule(specifier, from)).toBe(MARK);
  });

  test("and it agrees with the resolver the editor uses, on every one of them", () => {
    for (const [specifier, files] of [
      ["./theme", { "theme.ts": MARK }],
      ["./theme.js", { "theme.ts": MARK }],
      ["./theme", { "theme/index.ts": MARK }],
    ] as const) {
      const from = project(files);
      const theirs = editor(specifier, from, ts.ModuleResolutionKind.Bundler);
      const ours = readModule(specifier, from);

      // The editor resolved it, so the build must have read something rather than left a hole.
      expect(theirs).toBeDefined();
      expect(ours).toBe(MARK);
    }
  });

  describe("what it must not read", () => {
    test("a package specifier, which needs a resolver this does not have", () => {
      expect(readModule("@acme/theme", project({ "theme.ts": MARK }))).toBeUndefined();
    });

    test("a module that is not there", () => {
      expect(readModule("./missing", project({ "theme.ts": MARK }))).toBeUndefined();
    });

    test("and with no file to resolve from", () => {
      expect(readModule("./theme", "")).toBeUndefined();
    });
  });
});
