import ts from "typescript";

/**
 * The TYPES an entry point publishes that its own package declares — read from a real program, the
 * way a consumer's compiler reads them.
 *
 * Every `PublicSurface` test lists its types in `EXPECTED_TYPES`, and most proved only that the list
 * was sorted: a type exported from `index.ts` and missing from the list passed, though each test's
 * comment said it could not. `Object.keys` cannot help — a type is gone by the time there is an
 * object to ask — so this asks the checker for the module's exports, values and types in one list,
 * drops the values the caller names, and keeps what is declared under `packageRoot`. A type that
 * arrives through `export *` from another package — `@testing-library/dom` — is that package's.
 *
 * `@ramonda/css` found the gap first and reads its own the same way; see its `PublicSurface` test.
 */
export function publishedTypes(entry: string, values: readonly string[], packageRoot: string): string[] {
  const program = ts.createProgram([entry], {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    jsxImportSource: "@ramonda/core",
    noEmit: true,
    skipLibCheck: true,
  });
  const file = program.getSourceFile(entry);
  if (file === undefined) throw new Error(`no source file for ${entry}`);
  const checker = program.getTypeChecker();
  const module = checker.getSymbolAtLocation(file);
  if (module === undefined) throw new Error(`${entry} is not a module`);

  const own = (symbol: ts.Symbol): boolean => {
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    return (target.declarations ?? []).some((declaration) =>
      declaration.getSourceFile().fileName.startsWith(packageRoot),
    );
  };

  return checker
    .getExportsOfModule(module)
    .filter((symbol) => !values.includes(symbol.name) && own(symbol))
    .map((symbol) => symbol.name)
    .sort();
}
