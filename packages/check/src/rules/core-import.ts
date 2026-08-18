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
 * Shared rather than copied because two rules now turn on it, and they turn on it for the same
 * reason: an app is entitled to its own `requestContext`, and to its own `Head`. A rule that went
 * by NAME would report the reader's own code for the framework's rule.
 */
export function importedFromCore(id: ts.Node, resolveLocal: (node: ts.Node) => ts.Symbol | undefined): boolean {
  if (!ts.isIdentifier(id)) return false;
  const local = resolveLocal(id);
  return (local?.declarations ?? []).some((declaration) => {
    const clause =
      ts.isImportSpecifier(declaration) || ts.isNamespaceImport(declaration)
        ? declaration.parent.parent
        : ts.isImportClause(declaration)
          ? declaration
          : undefined;
    const statement = clause?.parent;
    if (!statement || !ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      return false;
    }
    const from = statement.moduleSpecifier.text;
    return from === "@ramonda/core" || from.startsWith("@ramonda/core/");
  });
}
