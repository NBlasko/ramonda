import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import ts from "typescript";
import { init } from "../plugin";

const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CARD = join(PACKAGE, "src", "__tests__", "Card.tsx");
const THEME = join(PACKAGE, "src", "__tests__", "theme.tsx");

/**
 * The overlay's cache and a file it does not own.
 *
 * A block that reads a token from another module resolves that token by HASHING that module's text,
 * so the answer depends on a file the cache is not keyed by. **Measured when cross-module resolution
 * was first written: editing the theme left every reader stale until it was touched** — the editor
 * kept saying a token existed after it was deleted, and would have kept an old name after a
 * descriptor changed.
 *
 * The version of a file the editor is not editing is the editor's own answer to "has this changed",
 * exactly as it is for the file being edited. So the entry remembers every module it read and the
 * version each had, and a hit requires all of them to still match.
 */
describe("the overlay cache and the modules a file reads", () => {
  const declares = `export const accent = @@property( syntax: "<color>"; inherits: true; initial-value: #10b981; );\n`;
  const declaresNothing = `export const accent = "--not-a-site";\n`;
  const card = `import { accent } from "./theme";\nexport const card = <div css={@@( color: var({accent}); )}>x</div>;\n`;

  /** A host whose files and versions can both move, which the shared harness's cannot. */
  function project() {
    const files: Record<string, string> = { [CARD]: card, [THEME]: declares };
    const versions: Record<string, string> = { [CARD]: "1", [THEME]: "1" };

    const host: ts.LanguageServiceHost = {
      getScriptFileNames: () => [CARD, THEME],
      getScriptVersion: (name) => versions[name] ?? "1",
      getScriptSnapshot: (name) => {
        const text = files[name] ?? ts.sys.readFile(name);
        return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
      },
      getCurrentDirectory: () => PACKAGE,
      getCompilationSettings: () => ({
        jsx: ts.JsxEmit.Preserve,
        strict: true,
        target: ts.ScriptTarget.ES2022,
        types: [],
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      }),
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      fileExists: (name) => files[name] !== undefined || ts.sys.fileExists(name),
      readFile: (name) => files[name] ?? ts.sys.readFile(name),
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
    };

    const service = init({ typescript: ts }).create({
      languageService: ts.createLanguageService(host),
      languageServiceHost: host,
      config: {},
    });

    return {
      /** The CSS rules' own reports, which is where a resolved reference shows up or fails to. */
      reports: () =>
        service
          .getSemanticDiagnostics(CARD)
          .map((one) => ts.flattenDiagnosticMessageText(one.messageText, " "))
          .filter((one) => one.includes("var()")),
      edit: (name: string, text: string) => {
        files[name] = text;
        versions[name] = `${Number(versions[name]) + 1}`;
      },
    };
  }

  test("a token the theme declares is resolved, so nothing is reported", () => {
    expect(project().reports()).toEqual([]);
  });

  test("and when the theme stops declaring it, the reader is told — without being touched", () => {
    const it = project();
    expect(it.reports()).toEqual([]);

    it.edit(THEME, declaresNothing);

    expect(it.reports()).toHaveLength(1);
    expect(it.reports()[0]).toContain("literal name");
  });

  test("the other way round too, so a fixed theme stops being reported", () => {
    const it = project();
    it.edit(THEME, declaresNothing);
    expect(it.reports()).toHaveLength(1);

    it.edit(THEME, declares);

    expect(it.reports()).toEqual([]);
  });
});
