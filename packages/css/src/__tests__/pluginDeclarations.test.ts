import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import ts from "typescript";
import { init } from "../plugin";

const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CARD = join(PACKAGE, "src", "__tests__", "Card.tsx");
const TYPES = join(PACKAGE, "src", "__tests__", "vendor.d.ts");

/**
 * A declaration file is never overlaid, and the reason is a measured cost.
 *
 * The overlay let through anything matching `\.[cm]?[jt]sx?$`, which is every `lib.*.d.ts` and every
 * `.d.ts` in `node_modules`. Measured through a real `tsserver` on a project holding ONE source
 * file: **174 files reached the overlay, 172 of them declarations, and 4.9 MB of text was read** —
 * per project, every time the editor opened one. It cost 190 ms of the 250 ms a project took.
 *
 * A declaration file cannot hold a block. It declares types and has no expressions, so there is
 * nowhere for `@@( … )` to be written — which makes reading it work done for an answer that is
 * known in advance.
 */
describe("a declaration file", () => {
  /** How many times the overlay asks the host for one file's text. */
  function reads(name: string, text: string): number {
    const files: Record<string, string> = { [CARD]: "export const card = @@( color: red; );\n", [name]: text };
    let asked = 0;

    const host: ts.LanguageServiceHost = {
      getScriptFileNames: () => [CARD, name],
      getScriptVersion: () => "1",
      getScriptSnapshot: (file) => {
        if (file === name) asked++;
        const found = files[file] ?? ts.sys.readFile(file);
        return found === undefined ? undefined : ts.ScriptSnapshot.fromString(found);
      },
      getCurrentDirectory: () => PACKAGE,
      getCompilationSettings: () => ({ jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022, types: [] }),
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      fileExists: (file) => files[file] !== undefined || ts.sys.fileExists(file),
      readFile: (file) => files[file] ?? ts.sys.readFile(file),
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
    };

    init({ typescript: ts }).create({
      languageService: ts.createLanguageService(host),
      languageServiceHost: host,
      config: {},
      project: { projectName: PACKAGE } as never,
    });

    // One ask, the way a program asks for a file it is about to parse.
    host.getScriptSnapshot(name);
    return asked;
  }

  test("is read once — the overlay hands it straight back", () => {
    expect(reads(TYPES, "export declare const vendor: string;\n")).toBe(1);
  });

  /**
   * The control, and it is the SAME shape: a plain `.ts` holding no block is read twice — once by
   * the overlay looking for one, once by the host answering with the real text. That is the work a
   * declaration file no longer does.
   */
  test("while an ordinary source file with no block is read twice", () => {
    expect(reads(join(PACKAGE, "src", "__tests__", "Other.ts"), 'export const x: string = "a";\n')).toBe(2);
  });
});
