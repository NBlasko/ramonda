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
 * ## A template a bundler CAN read, which this used to report
 *
 * `` import(`./pages/${name}.js`) `` is not a path the bundler cannot read: Vite turns it into a
 * chunk per matching file, and reporting it was reporting a documented feature working exactly as
 * documented. Both halves are needed, and the boundary was measured with Vite 7 rather than
 * reasoned about:
 *
 * | written | modules transformed | chunks emitted |
 * |---|---|---|
 * | `` `./pages/${w}.js` `` | 4 | `a-*.mjs`, `b-*.mjs` — **split** |
 * | `` `./pages/${w}` `` — no suffix | 1 | none |
 * | `` `pages/${w}.js` `` — not relative | 1 | none |
 * | `import(specifier)` | 1 | none |
 *
 * So a template splits only with a RELATIVE head and a non-empty tail after the last substitution.
 * The last three rows are the rule's own claim, confirmed: nothing is emitted, and at run time
 * there is nothing to fetch.
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
 * Whether a template is one a bundler can turn into chunks — measured, see the note above.
 *
 * A RELATIVE head, so the pattern names a place in this project rather than a bare package name,
 * and a non-empty tail after the last substitution, so the pattern ends in something — an
 * extension. Either half missing and Vite emits nothing at all.
 */
function splittableTemplate(specifier: ts.Expression): boolean {
  if (!ts.isTemplateExpression(specifier)) return false;
  if (!/^\.{1,2}\//.test(specifier.head.text)) return false;

  const last = specifier.templateSpans[specifier.templateSpans.length - 1];
  return last !== undefined && last.literal.text.length > 0;
}

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

export const unsplittableImport = {
  id: "unsplittable-import",

  report: {
    severity: "warn",
    reportedWhen:
      "a dynamic import's path is neither a literal nor a template a bundler can read, so no chunk is emitted for it",
    heading: (found) => `${found.length} dynamic import(s) the bundler cannot split:`,
    lines: (site) => [
      `  ${site.file}:${site.line}:${site.column}`,
      `    import(${site.path}) — the path is not a literal.`,
    ],
    advice:
      "A bundler splits at a dynamic import and nowhere else, and only when it can read the path\n" +
      "at build time. Written as a variable there is no chunk: the module is pulled into the\n" +
      "caller's chunk, or left out of the build entirely and looked for at run time — which works\n" +
      "in dev, where the server serves source, and 404s in production, where nothing emitted it.\n\n" +
      'Write the path as a plain string: `import("./feature/heavy.js")`. For one of several, a\n' +
      "literal per branch splits each of them; a variable splits none.\n\n" +
      "If it is deliberate, say so and this stops reporting it — either the bundler's own marker,\n" +
      "`import(/* @vite-ignore */ name)`, or `// ramonda-check-ignore why` on the line above.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(file, { unlessAnnotated }) {
    const found: UnsplittableImportIssue[] = [];

    (function scan(node: ts.Node) {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const specifier = node.arguments[0];
        // No argument at all is a different mistake and one the compiler already refuses.
        if (
          specifier !== undefined &&
          !ts.isStringLiteralLike(specifier) &&
          !splittableTemplate(specifier) &&
          !bundlerTold(node)
        ) {
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
} as const satisfies ModuleRule<UnsplittableImportIssue>;
