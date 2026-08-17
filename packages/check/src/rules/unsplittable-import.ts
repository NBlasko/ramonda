import ts from "typescript";
import { positionOf } from "../syntax";
import type { ModuleRule } from "./rule";

/**
 * A dynamic `import()` whose path is not a string literal.
 *
 * A bundler splits at a dynamic import and nowhere else, and it can only do that when it can read
 * the path at build time. `import(specifier)` is a path it cannot read, so there is no chunk: the
 * module is either pulled into the caller's chunk or, more often, left out of the build entirely
 * and looked for at run time — which works in dev, where the server serves source, and 404s in
 * production, where nothing emitted it.
 *
 * The fault is quiet in the same way the target one was: the build succeeds and says nothing.
 * `ramonda-check --split` counts the split points a project HAS; this names a place where one was
 * meant and is not there.
 *
 * ## Why the annotation is honoured rather than argued with
 *
 * Measured across this repository before the rule was written: 88 dynamic imports with a literal
 * path, 3 without — and all three carry `/* @vite-ignore *\/`, which is the bundler's own marker
 * for exactly this. Every one is deliberate: a chunk name that is missing on purpose, a search
 * index loaded by a computed specifier, the devtools panel behind a name the build must not follow.
 *
 * That is decisive about the shape of the rule rather than about whether to have one. The premise
 * is "nothing tells you when you defeat splitting" — and at a site carrying `@vite-ignore` the
 * bundler told the author and the author answered. Reporting those three would have been the
 * rule's first act against this repository, which is the failure this package's README opens with.
 */
export interface UnsplittableImportIssue {
  /** What was written in the import — `specifier`, `PAGES[key]`. */
  path: string;
  file: string;
  line: number;
  column: number;
}

/** The bundler's own marker for "I know, do not follow this one". */
const BUNDLER_IGNORE = /@(vite|webpack)-ignore\b/;

/**
 * Whether the call carries the bundler's marker in a comment inside its argument list.
 *
 * Read from the call's own text rather than from attached comment nodes: the marker is written
 * INSIDE the parentheses — `import(/* @vite-ignore *\/ name)` — where it is an argument-leading
 * comment that TypeScript attaches to the argument, not to the call, and where a reader plainly
 * sees it as part of the import.
 */
function bundlerTold(call: ts.CallExpression): boolean {
  return BUNDLER_IGNORE.test(call.getText());
}

export const unsplittableImport: ModuleRule<UnsplittableImportIssue> = {
  id: "unsplittable-import",

  read(file, { unlessAnnotated }) {
    const found: UnsplittableImportIssue[] = [];

    (function scan(node: ts.Node) {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const specifier = node.arguments[0];
        // No argument at all is a different mistake and one the compiler already refuses.
        if (specifier !== undefined && !ts.isStringLiteralLike(specifier) && !bundlerTold(node)) {
          const issue = unlessAnnotated(node, () => ({
            path: specifier.getText(),
            ...positionOf(node),
          }));
          if (issue) found.push(issue);
        }
      }
      ts.forEachChild(node, scan);
    })(file);

    return found;
  },
};
