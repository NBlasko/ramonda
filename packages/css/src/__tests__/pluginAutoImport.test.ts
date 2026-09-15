import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, test } from "vitest";
import { init } from "../plugin";

/**
 * Auto-import, in a file that carries a block — its own harness, because it needs a second module.
 *
 * **Reported by a user**, in their words: *"primetio sam da mi ovaj import u tsx fajlu dolazi na
 * kraju fajla … kada sam obrisao `@@` blok, i probao import, import je isao na vrhu fajla."* They
 * put it down to VS Code. It is ours.
 *
 * `getCompletionsAtPosition` is proxied and maps the caret into the virtual file.
 * `getCompletionEntryDetails` was NOT proxied, so it got the AUTHOR's position against the VIRTUAL
 * text — a different place entirely. The editor is handed an entry it can offer and cannot resolve,
 * and what it then writes is nobody's decision.
 *
 * The same shape as the rename fault documented in `plugin.ts`: an unmapped span that an editor
 * WRITES at. This one differs in that refusing is not enough — an import is a thing an author needs
 * — so the spans are mapped home, and a code action holding one that maps nowhere is dropped whole.
 */

const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FILE = join(PACKAGE, "src", "__tests__", "Importer.tsx");
const JSX = join(PACKAGE, "src", "__tests__", "jsx.d.ts");
const THEME = join(PACKAGE, "src", "__tests__", "theme.ts");

const editor = (source: string) => {
  const files: Record<string, string> = {
    [FILE]: source,
    [JSX]: `declare namespace JSX {\n  interface IntrinsicElements { div: { css?: unknown; children?: unknown } }\n  interface Element { readonly _brand: unique symbol }\n}\n`,
    [THEME]: `export const palette = "#10b981";\n`,
  };

  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [FILE, JSX, THEME],
    getScriptVersion: () => "1",
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

  const plain = ts.createLanguageService(host);
  return init({ typescript: ts }).create({
    languageService: plain,
    languageServiceHost: host,
    config: { properties: join(PACKAGE, "src", "properties") },
  });
};

/** Where accepting the `palette` completion would write, in the AUTHOR's own coordinates. */
const importFor = (source: string) => {
  const service = editor(source);
  const caret = source.indexOf("palette") + 3;
  const preferences = { includeCompletionsForModuleExports: true, allowIncompleteCompletions: true };

  const entry = service
    .getCompletionsAtPosition(FILE, caret, preferences)
    ?.entries.find((one) => one.name === "palette" && one.source !== undefined);

  const details = service.getCompletionEntryDetails(
    FILE,
    caret,
    "palette",
    // Real ones: TypeScript builds its change tracker from these and throws without them.
    ts.getDefaultFormatCodeSettings("\n"),
    entry?.source,
    preferences,
    entry?.data,
  );

  return (details?.codeActions ?? []).flatMap((one) => one.changes.flatMap((each) => each.textChanges));
};

const WITH_A_BLOCK = `const gap = 8;
export const a = <div css={@@( padding: 8px; )}>x</div>;
export const b = palette;
`;

const WITHOUT = `const gap = 8;
export const a = <div>x</div>;
export const b = palette;
`;

describe("accepting an auto-import in a file that carries a block", () => {
  test("the import is offered at all, which it was not", () => {
    expect(importFor(WITH_A_BLOCK)).not.toEqual([]);
  });

  test("and it is written at the TOP, the same as in a file with no block", () => {
    const [change] = importFor(WITH_A_BLOCK);

    expect(change.newText).toContain("theme");
    expect(change.span.start).toBe(0);
  });

  /** The control: a file with no block was always right, and must stay right. */
  test("a file with no block is unchanged by any of this", () => {
    const [change] = importFor(WITHOUT);

    expect(change.span.start).toBe(0);
    expect(change.newText).toContain("theme");
  });

  /** And it must never land past the author's own text, which is what the user saw. */
  test("never past the end of the file", () => {
    for (const change of importFor(WITH_A_BLOCK)) {
      expect(change.span.start).toBeLessThanOrEqual(WITH_A_BLOCK.length);
    }
  });
});
