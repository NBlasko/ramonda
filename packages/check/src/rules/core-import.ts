import ts from "typescript";
import { packageRootOf } from "../fragment";
import type { Resolver } from "./rule";

/**
 * Whether an identifier was imported from `@ramonda/core`.
 *
 * By the written module SPECIFIER, not by where the declaration file sits on disk. Every project
 * here aliases `@ramonda/core` to `packages/core/src` so the analyzer reads sources rather than
 * `dist` — a path test would answer on the alias's target, which differs per project, while the
 * specifier is the same string the reader typed.
 *
 * **It takes the LOCAL symbol, alias unfollowed**, which is why it is handed `resolveLocal` rather
 * than `resolve`. The evidence is the import statement itself: followed through the alias, the
 * declaration is core's own and says nothing about how this file reached it. `import { X as y }`
 * and `import * as core from "@ramonda/core"` both arrive here — the first through its
 * `ImportSpecifier`, the second through the namespace identifier.
 *
 * Shared rather than copied because several rules now turn on it, and they turn on it for the same
 * reason: an app is entitled to its own `requestContext`, to its own `Head` and to its own `list`.
 * A rule that went by NAME would report the reader's own code for the framework's rule.
 *
 * ## A RE-EXPORT is followed, and that takes nothing away
 *
 * `export { list } from "@ramonda/core"` in an app's own `ui` module hands on the framework's own
 * binding, so a file importing from `./ui` is importing core's. Stopping at the first import made
 * that invisible — measured, a row callback reached through a re-exported `list` was reported by
 * nothing.
 *
 * It does not weaken the guarantee above, which is the reason it is safe: an app's OWN function
 * called `list` has its own declaration and no export chain leading to core, so it still resolves
 * to itself and is still left alone. Only a binding that really is core's arrives here.
 *
 * Bounded, because a chain that re-exports in a ring would otherwise not end.
 */
export function importedFromCore(
  id: ts.Node,
  resolveLocal: (node: ts.Node) => ts.Symbol | undefined,
  resolveStep?: (node: ts.Node) => ts.Symbol | undefined,
  exportedAs?: string,
): boolean {
  return importedFromPackage(id, "@ramonda/core", resolveLocal, resolveStep, exportedAs);
}

/**
 * The same question about ANY `@ramonda` package, which is what the walk above always answered.
 *
 * `lens-path-through-a-gap` needs it for `focusOn`, and needs it for the reason every caller of
 * {@link importedFromCore} needs that one: an app may have a `focusOn` of its own, or a local of
 * that name shadowing the import, and a rule going by the written name would judge somebody else's
 * function by the lens's semantics. Nothing about the walk was ever specific to core — the
 * specifier was a literal in two places and the sub-path form (`@ramonda/core/jsx-runtime`) is a
 * shape every package here has.
 */
export function importedFromPackage(
  id: ts.Node,
  pkg: string,
  resolveLocal: (node: ts.Node) => ts.Symbol | undefined,
  resolveStep?: (node: ts.Node) => ts.Symbol | undefined,
  exportedAs?: string,
): boolean {
  if (!ts.isIdentifier(id)) return false;
  return reaches(resolveLocal(id), pkg, resolveStep, exportedAs, 0);
}

/**
 * The name `@ramonda/core` exports this binding under, or `undefined` when it is not core's.
 *
 * The other half of the same question, for a caller that has to LOOK the name UP rather than
 * compare it: `lifecycle-env` reads a decorator's name to find it in a table of what each one does,
 * and reading the LOCAL name meant `import { created as onCreate }` found nothing in that table.
 */
export function coreExportName(
  id: ts.Node,
  resolveLocal: (node: ts.Node) => ts.Symbol | undefined,
  resolveStep?: (node: ts.Node) => ts.Symbol | undefined,
  resolveFully?: (node: ts.Node) => ts.Symbol | undefined,
): string | undefined {
  /**
   * `core.state` — a NAMESPACE import, which keeps the export's own name on the property.
   *
   * The whole point of this function is that identity is the name the MODULE gave a binding, and a
   * namespace access is the one spelling where that name is written down verbatim at the call site.
   * Reading only an identifier meant `@core.StableProps` was invisible to `duplicate-decorators` and
   * `@core.state` to `decorator-that-adds-nothing` — measured on a plant, both silent on the
   * identical fault their aliased form was reported for. (The measurement was taken on `@core.Host`,
   * which the framework no longer has; the spelling is what mattered, not the decorator.)
   *
   * Fixed HERE rather than in each caller, because it had already been patched inline in
   * `lifecycle-env` an hour earlier and a third caller would have needed it next.
   */
  if (ts.isPropertyAccessExpression(id)) {
    return importedFromCore(id.expression, resolveLocal, resolveStep) ? id.name.text : undefined;
  }
  if (!ts.isIdentifier(id)) return undefined;
  const byChain = nameAtCore(resolveLocal(id), resolveStep, 0);
  if (byChain !== undefined) return byChain;
  return resolveFully === undefined ? undefined : declaredInsideCore(resolveFully(id));
}

/**
 * The name a declaration carries when it lives INSIDE `@ramonda/core` itself.
 *
 * The specifier chain cannot answer for core's own source, and that is not an edge case: core
 * imports its own decorators relatively — `import { StableProps } from "./decorators"` in
 * `base/Head.ts` — so nothing in that file names `@ramonda/core` at all. Every project in this
 * repository maps the package to core's SOURCE, so `Head`'s `@StableProps("meta", "link")` was read
 * as somebody else's the moment decorators started resolving, and `fresh-object-in-hook-props`
 * reported a `meta` array that the hook has DECLARED stable — reporting the fix, on the framework's
 * own hook. Measured in `apps/playground-ssr`.
 *
 * It answers the star re-export too, and nothing else can: `export * from "@ramonda/core"` in an
 * app's own `ui` module resolves straight to core's own declaration, which names no module at all,
 * so the specifier chain has nothing left to walk. Measured — a barrel switched off every class
 * rule at once, because `hasDecorator` is the one chokepoint they all read through.
 *
 * By the PACKAGE NAME rather than a path, which is what keeps it honest: an app's own decorator of
 * the same name lives in the app's package and is still nobody's business but the app's. The
 * package root is read from disk once per directory.
 */
function declaredInsideCore(symbol: ts.Symbol | undefined): string | undefined {
  // EVERY declaration, not the first: a name with an overload set or a merged namespace has more
  // than one, and which of them comes first is not something to build an identity on.
  for (const declaration of symbol?.declarations ?? []) {
    // A `.d.ts` inside core's package IS core — this is a question about identity, not about a body
    // to walk, and a published package is exactly where a star re-export lands.
    if (!packageIsCore(declaration.getSourceFile().fileName)) continue;

    const named = (declaration as { name?: ts.Node }).name;
    if (named !== undefined && ts.isIdentifier(named)) return named.text;
  }
  return undefined;
}

/**
 * Whether a file belongs to the package called `@ramonda/core`.
 *
 * NOT cached, and that is a measurement rather than an oversight. A cache keyed on the directory
 * path never invalidates — unlike `row-callback.ts`'s `WeakMap`, which hangs on a `SourceFile` and
 * dies with the program — so it would carry one run's answer into the next for as long as the
 * process lives. Weighed against that: with the cache `apps/docs` runs in 1.26 s and
 * `packages/core` in 0.68 s; without it, 1.28 s and 0.71 s. Inside the noise, because this is
 * reached only where the specifier chain has already failed, which is core's own source and a star
 * re-export and nothing else.
 */
function packageIsCore(fileName: string): boolean {
  const root = packageRootOf(fileName);
  if (root === undefined) return false;

  try {
    const raw = ts.sys.readFile(`${root}/package.json`);
    return raw !== undefined && (JSON.parse(raw) as { name?: string }).name === "@ramonda/core";
  } catch {
    return false;
  }
}

/** Walks the same chain `reaches` does and hands back the name at the end of it. */
function nameAtCore(
  symbol: ts.Symbol | undefined,
  resolveStep: ((node: ts.Node) => ts.Symbol | undefined) | undefined,
  hop: number,
): string | undefined {
  if (symbol === undefined || hop > 4) return undefined;

  for (const declaration of symbol.declarations ?? []) {
    const from = specifierOf(declaration);
    if (from === "@ramonda/core" || from?.startsWith("@ramonda/core/") === true) {
      return exportedName(declaration);
    }
    if (resolveStep === undefined) continue;
    const named = ts.isImportSpecifier(declaration) || ts.isExportSpecifier(declaration) ? declaration.name : undefined;
    const deeper = named === undefined ? undefined : nameAtCore(resolveStep(named), resolveStep, hop + 1);
    if (deeper !== undefined) return deeper;
  }
  return undefined;
}

/**
 * Whether this symbol's chain names `@ramonda/core` — directly, or a re-export or two along.
 *
 * `exportedAs` asks the second half of the question, and it is the half a caller used to answer for
 * itself by comparing the LOCAL name. `import { requestContext as rc }` and
 * `export { Head } from "@ramonda/core"` both give the binding another name, and a rule checking
 * `id.text === "requestContext"` before asking this went quiet on both. The name that decides is
 * the one the MODULE exports, which is `propertyName ?? name` on the specifier that reaches core.
 */
function reaches(
  symbol: ts.Symbol | undefined,
  pkg: string,
  resolveStep: ((node: ts.Node) => ts.Symbol | undefined) | undefined,
  exportedAs: string | undefined,
  hop: number,
): boolean {
  if (symbol === undefined || hop > 4) return false;

  return (symbol.declarations ?? []).some((declaration) => {
    const from = specifierOf(declaration);
    if (from === pkg || from?.startsWith(`${pkg}/`) === true) {
      return exportedAs === undefined || exportedName(declaration) === exportedAs;
    }
    if (resolveStep === undefined) return false;

    /**
     * `import { list } from "./ui"` where `ui` re-exports core's — one hop lands on the
     * `ExportSpecifier` in that module, and the hop after it on core's own import.
     */
    const named = ts.isImportSpecifier(declaration) || ts.isExportSpecifier(declaration) ? declaration.name : undefined;
    return named === undefined ? false : reaches(resolveStep(named), pkg, resolveStep, exportedAs, hop + 1);
  });
}

/** The name the MODULE exports this binding under, whatever the importer called it. */
function exportedName(declaration: ts.Declaration): string | undefined {
  if (!ts.isImportSpecifier(declaration) && !ts.isExportSpecifier(declaration)) return undefined;
  const written = declaration.propertyName ?? declaration.name;
  return ts.isIdentifier(written) ? written.text : undefined;
}

/**
 * The module an import or export declaration names, when it names one.
 *
 * Each shape sits a different distance from its statement, and a NAMESPACE import used to be walked
 * as if it were a named one — one parent too far, landing on the source file. So
 * `import * as core from "@ramonda/core"` followed by `core.requestContext()` was identified as
 * nobody's, although this helper's own docstring said it arrived here. Found by planting it while
 * reviewing, and it had been wrong from the start:
 *
 * - `ImportSpecifier` → `NamedImports` → `ImportClause` → `ImportDeclaration`
 * - `NamespaceImport` → `ImportClause` → `ImportDeclaration`
 * - `ImportClause` → `ImportDeclaration`
 * - `ExportSpecifier` → `NamedExports` → `ExportDeclaration`
 */
function specifierOf(declaration: ts.Declaration): string | undefined {
  const statement = ts.isImportSpecifier(declaration)
    ? declaration.parent.parent.parent
    : ts.isNamespaceImport(declaration)
      ? declaration.parent.parent
      : ts.isImportClause(declaration)
        ? declaration.parent
        : ts.isExportSpecifier(declaration)
          ? declaration.parent.parent
          : undefined;

  if (statement === undefined) return undefined;
  if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) return undefined;

  const named = statement.moduleSpecifier;
  return named !== undefined && ts.isStringLiteral(named) ? named.text : undefined;
}

/**
 * The name `@ramonda/core` exports a DECORATOR under, or `undefined` when it is not core's.
 *
 * Every rule that reads a decorator asked for the name written on the class, which fails the two
 * ways a bare name always does. Measured with `fixtures/aliased-more`: `@StableProps` under an alias
 * made `fresh-object-in-props` report a prop the child had DECLARED — reporting the fix — while an
 * aliased `@watchProp` and `@StableProps` went quiet.
 */
export function coreDecoratorName(decorator: ts.Decorator, resolve: Resolver): string | undefined {
  const written = ts.isCallExpression(decorator.expression) ? decorator.expression.expression : decorator.expression;
  return resolve.coreName(written);
}
