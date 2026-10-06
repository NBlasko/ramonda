import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, test } from "vitest";
import { generate } from "../config/codegen";
import { kind } from "../config/declared";
import { init } from "../adapters/plugin";
const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPO = resolve(PACKAGE, "..", "..");
/**
 * A hover on `$color.accent.quiet` — in code and inside a block — shows the variable's doc comment:
 * its kind, the custom property it really is, what it starts as, and whether it may change. Asked
 * for while debugging, because the style panel names `--color-accent-quiet` and the type did not.
 * Through a real language service and the plugin, with the module codegen writes.
 */
test("a hover on a variable says its kind, its CSS name, its start and its range, in code and in a block", () => {
  const dir = mkdtempSync(join(tmpdir(), "ramonda-hover-"));
  symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"));
  mkdirSync(join(dir, "css-system"));
  writeFileSync(
    join(dir, "css-system", "index.ts"),
    generate({ $color: kind("color", { accent: { quiet: "#00b37e" } }) }).module,
  );
  const file = join(dir, "a.tsx");
  const source = `import { $color } from "./css-system";\nexport const v = $color.accent.quiet;\nexport const b = <div className={@@( color: $color.accent.quiet; )}>x</div>;\n`;
  writeFileSync(file, source);
  writeFileSync(
    join(dir, "jsx.d.ts"),
    `declare namespace JSX { interface IntrinsicElements { [k: string]: any } interface Element {} }`,
  );
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [file, join(dir, "jsx.d.ts")],
    getScriptVersion: () => "1",
    getScriptSnapshot: (n) => {
      const t = ts.sys.readFile(n);
      return t === undefined ? undefined : ts.ScriptSnapshot.fromString(t);
    },
    getCurrentDirectory: () => dir,
    getCompilationSettings: () => ({
      jsx: ts.JsxEmit.Preserve,
      strict: true,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      types: [],
    }),
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
  const service = init({ typescript: ts }).create({
    languageService: ts.createLanguageService(host),
    languageServiceHost: host,
    config: { properties: join(dir, "css-system") },
  });
  const said = (at: number) =>
    service
      .getQuickInfoAtPosition(file, at + 1)
      ?.documentation?.map((one) => one.text)
      .join("");
  const expected =
    "`$color.accent.quiet` — a `color`, written to CSS as `var(--color-accent-quiet)`.\n\n" +
    "Starts as `#00b37e`. Fixed: declared without a `range`, so nothing may set it.";

  expect(said(source.indexOf("quiet"))).toBe(expected);
  expect(said(source.lastIndexOf("quiet"))).toBe(expected);
});
