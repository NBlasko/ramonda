import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterEach, describe, expect, test } from "vitest";
import { init } from "../plugin";
import { forgetGenerated, writeGenerated } from "../generate";

/**
 * **The config reaching the EDITOR, which is the half a person checks first.**
 *
 * The user asked for exactly this, in these words: forbid a property, and let me confirm it is not
 * in the autocomplete and that writing it screams — and only then narrow its values.
 *
 * It is worth its own file because the two halves come from different places and could disagree
 * without either being broken. The types come from the generated module; the value COMPLETIONS come
 * from `valueWords`, which read a shipped constant and knew nothing about a project's config. A
 * property the type refuses and the editor still suggests is the worst of both.
 */

const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CARET = "/*|*/";
/** The repository node_modules, because a package does not contain itself. */
const REPO = resolve(PACKAGE, "..", "..");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * A REAL project: a config on disk, codegen run over it, and an editor opened on a file inside.
 *
 * Every shortcut here was tried and each made the test green while checking nothing:
 *
 * - a temp directory with no `node_modules` — `@ramonda/css/properties` resolves to nothing, the
 *   block's type is `any`, and every completion is the global scope. Measured: 1,000 entries
 *   beginning `AbortController`, so "this property is not offered" passes because none is.
 * - the generated module handed to the plugin as an option, with no config file — the plugin reads
 *   the project's own `ramonda.css.ts` for the completion half, so the types narrowed and the
 *   suggestions did not.
 *
 * So it is a real tree. Slower, and the only arrangement that can fail.
 */
function editorWith(rules: string, marked: string, variables: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), "ramonda-editor-"));
  roots.push(root);
  symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "probe", type: "module", version: "0.0.0" }));
  const declared = Object.entries(variables)
    .map(([name, group]) => `  ${name}: ${group},`)
    .join("\n");
  writeFileSync(
    join(root, "ramonda.css.ts"),
    `import { kind } from "@ramonda/css/config";\n` +
      `export default { properties: ${rules}, variables: {\n${declared}\n} };\n`,
  );
  writeGenerated(root, ts);
  forgetGenerated();

  const FILE = join(root, "src", "Card.tsx");
  const JSX_FILE = join(root, "src", "jsx.d.ts");
  const caret = marked.indexOf(CARET);
  const source = marked.replace(CARET, "");

  const files: Record<string, string> = {
    [FILE]: source,
    [JSX_FILE]: `declare namespace JSX {\n  interface IntrinsicElements { div: { css?: unknown; children?: unknown } }\n  interface Element { readonly _brand: unique symbol }\n}\n`,
  };

  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [FILE, JSX_FILE],
    getScriptVersion: () => "1",
    getScriptSnapshot: (name) => {
      const text = files[name] ?? ts.sys.readFile(name);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => root,
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
  (host as { getSourceFileLike?: (name: string) => ts.SourceFile | undefined }).getSourceFileLike = (name) =>
    plain.getProgram()?.getSourceFile(name);

  const service = init({ typescript: ts }).create({
    languageService: plain,
    languageServiceHost: host,
    config: {},
  } as never);

  return {
    offered: () => service.getCompletionsAtPosition(FILE, caret, undefined)?.entries.map((one) => one.name) ?? [],
    reported: () =>
      service.getSemanticDiagnostics(FILE).map((one) => ts.flattenDiagnosticMessageText(one.messageText, " ")),
  };
}

describe("a property this project switched off", () => {
  const OFF = `{ "*": { shorthand: false }, margin: { shorthand: true } }`;

  test("is not offered where a property name goes", () => {
    const { offered } = editorWith(OFF, `const a = <div css={@@( /*|*/ )}>x</div>;\n`);
    const names = offered();

    // The control comes first: a list that is empty would pass the assertion below for free.
    expect(names).toContain("padding-left");
    expect(names).not.toContain("padding");
  });

  test("the one brought back by name IS offered", () => {
    const { offered } = editorWith(OFF, `const b = <div css={@@( /*|*/ )}>x</div>;\n`);

    expect(offered()).toContain("margin");
  });

  test("and writing it anyway is reported", () => {
    const { reported } = editorWith(OFF, `const c = <div css={@@( padding: 8px; )}>x</div>;\n`);

    expect(reported().join("\n")).toMatch(/padding/);
  });

  test("its longhand is silent, which is what switching it off is for", () => {
    const { reported } = editorWith(OFF, `const d = <div css={@@( padding-left: 8px; )}>x</div>;\n`);

    expect(reported()).toEqual([]);
  });
});

describe("a property narrowed to a list of values", () => {
  const LIST = `{ "z-index": { values: [1, 2, 5, 10] } }`;

  /**
   * The caret sits ON a partly-typed value, which is where an editor asks — a caret in empty space
   * after the colon belongs to no run yet and is answered with the property names, measured.
   */
  test("the editor offers those values and nothing else", () => {
    const { offered } = editorWith(LIST, `const e = <div css={@@( z-index: 5/*|*/ )}>x</div>;\n`);
    const names = offered();

    expect(names).toContain("5");
    expect(names).not.toContain("3");
  });

  /**
   * ONE message, and it is ours — the editor was showing two.
   *
   * **Reported by the user**, who hovered a narrowed `z-index` and read the rule's sentence beside
   * the raw type: *"i dalje ne dozvoljava string"*. The type lists `"0" | "1" | …` because a block
   * is CSS and `z-index: 1` reaches it as a string; the rule says the value is not permitted. Both
   * true, shown together, and together they read as a contradiction.
   *
   * Measured: every setting given a rule in pass 4 came back twice in the EDITOR, because `check.ts`
   * got the drop and `plugin.ts` did not. The recurring fault, in the consumer a person actually
   * looks at.
   */
  test("a value outside the list is reported once, by the rule", () => {
    const { reported } = editorWith(LIST, `const f = <div css={@@( z-index: 3; )}>x</div>;\n`);
    const said = reported();

    expect(said).toHaveLength(1);
    expect(said[0]).toContain("[value-not-allowed]");
    expect(said.join("\n")).not.toMatch(/is not assignable/);
  });

  test.each([
    ["a unit", `<div css={@@( letter-spacing: 2rem; )}>x</div>`, "[unit-not-allowed]"],
    ["a shorthand", `<div css={@@( margin: 8px; )}>x</div>`, "[shorthand-not-allowed]"],
  ])("%s is reported once too", (_what, written, said) => {
    const reported = editorWith(
      `{ "*": { units: ["px"] }, margin: { shorthand: false } }`,
      `const h = ${written};\n`,
    ).reported();

    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain(said);
  });

  test("and one inside it is silent", () => {
    const { reported } = editorWith(LIST, `const g = <div css={@@( z-index: 5; )}>x</div>;\n`);

    expect(reported()).toEqual([]);
  });
});

/**
 * `$` in a block, with NO import in the file — which is what a user met and what settled the design.
 *
 * The first version left `$` to ordinary scope, and TypeScript answered
 * `Cannot find name '$'. Do you need to install type definitions for jQuery?` — a library nothing
 * here touches — with completion dead beside it, because the name resolved to nothing. A block is
 * this package's language and `$` belongs to it, so the virtual file binds it.
 */
describe("`$` without an import", () => {
  const VARS = `{}`;

  test("completes one level at a time", () => {
    const { offered } = editorWith(VARS, `const a = <div css={@@( color: $./*|*/ )}>x</div>;\n`, {
      color: `kind("color", { accent: { main: "#10b981" } })`,
      space: `kind("length", { gutter: { tight: "8px" } })`,
    });

    expect(offered()).toEqual(expect.arrayContaining(["color", "space"]));
  });

  test("and the next level down", () => {
    const { offered } = editorWith(VARS, `const b = <div css={@@( color: $.color.accent./*|*/ )}>x</div>;\n`, {
      color: `kind("color", { accent: { main: "#10b981", quiet: "#00b37e" } })`,
    });

    expect(offered()).toEqual(expect.arrayContaining(["main", "quiet"]));
  });

  test("a path is silent, mixed into a value and alone", () => {
    const { reported } = editorWith(
      VARS,
      `const c = <div css={@@( gap: 4px $.space.gutter.tight; color: $.color.accent.main; )}>x</div>;\n`,
      {
        color: `kind("color", { accent: { main: "#10b981" } })`,
        space: `kind("length", { gutter: { tight: "8px" } })`,
      },
    );

    expect(reported()).toEqual([]);
  });

  test("and nothing names jQuery, whatever else it says", () => {
    const { reported } = editorWith(VARS, `const d = <div css={@@( color: $.nope.at.all; )}>x</div>;\n`, {
      color: `kind("color", { accent: { main: "#10b981" } })`,
    });

    expect(reported().join("\n")).not.toMatch(/jQuery/);
    expect(reported().join("\n")).toMatch(/nope/);
  });
});
