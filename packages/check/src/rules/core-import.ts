import ts from "typescript";

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
): boolean {
  if (!ts.isIdentifier(id)) return false;
  return reaches(resolveLocal(id), resolveStep, 0);
}

/** Whether this symbol's chain names `@ramonda/core` — directly, or a re-export or two along. */
function reaches(
  symbol: ts.Symbol | undefined,
  resolveStep: ((node: ts.Node) => ts.Symbol | undefined) | undefined,
  hop: number,
): boolean {
  if (symbol === undefined || hop > 4) return false;

  return (symbol.declarations ?? []).some((declaration) => {
    const from = specifierOf(declaration);
    if (from === "@ramonda/core" || from?.startsWith("@ramonda/core/") === true) return true;
    if (resolveStep === undefined) return false;

    /**
     * `import { list } from "./ui"` where `ui` re-exports core's — one hop lands on the
     * `ExportSpecifier` in that module, and the hop after it on core's own import.
     */
    const named = ts.isImportSpecifier(declaration) || ts.isExportSpecifier(declaration) ? declaration.name : undefined;
    return named === undefined ? false : reaches(resolveStep(named), resolveStep, hop + 1);
  });
}

/** The module an import or export declaration names, when it names one. */
function specifierOf(declaration: ts.Declaration): string | undefined {
  const statement =
    ts.isImportSpecifier(declaration) || ts.isNamespaceImport(declaration)
      ? declaration.parent.parent.parent
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
