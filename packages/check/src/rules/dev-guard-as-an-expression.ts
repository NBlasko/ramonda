import ts from "typescript";
import { positionOf } from "../syntax";
import type { ModuleRule } from "./rule";

/**
 * A `__DEV__` guard written as an operator rather than as an `if`.
 *
 * `__DEV__ && publish()` and `__DEV__ ? publish() : undefined` do what `if (__DEV__) publish()`
 * does, and the framework asks for the `if`. Not because the build cares — measured with esbuild
 * and `__DEV__: false`, the `&&` form is DROPPED where an unminified `if (false) { … }` keeps its
 * whole block, string literals and all, and with `minify: true` (which every package here uses)
 * both vanish identically. So the reason is not dead code.
 *
 * The reason is that a flag with two spellings has to be read twice by everything that reads it,
 * and this repository has already paid for that: `dev-guard.ts` was written against the `if` alone,
 * so `listener-added-by-hand` reported dev-only code for being written the other way. One spelling
 * is one thing to grep, one thing to teach, and one thing for a rule to get right.
 *
 * ## Only where `if` is a REPLACEMENT
 *
 * A statement, and nothing else. `const name = __DEV__ ? displayName(x) : ""` uses the VALUE, and
 * an `if` is not a drop-in for it — advice that does not fit the site it fires on is how a rule
 * earns being switched off. Five of those are written in this repository and none is reported.
 *
 * `if (__DEV__ && somethingElse)` is not this either: that is a conjunction INSIDE the `if`, which
 * is the shape being asked for. 149 of them are written here.
 */
export interface DevGuardAsAnExpressionIssue {
  /** How it was written — `&&` or `?:`. */
  written: "&&" | "?:";
  /** What the guard runs, as the reader will find it on the line. */
  guarding: string;
  file: string;
  line: number;
  column: number;
}

/** Whether this condition is the `__DEV__` flag, by name — it is a build-time define, not an import. */
function isDevFlag(expression: ts.Expression): boolean {
  return ts.isIdentifier(expression) && expression.text === "__DEV__";
}

/** What a guard runs, shortened, so a report quotes the line without printing a screenful. */
function shorten(node: ts.Node): string {
  const text = node.getText().replace(/\s+/g, " ");
  return text.length > 48 ? `${text.slice(0, 45)}…` : text;
}

export const devGuardAsAnExpression = {
  id: "dev-guard-as-an-expression",

  report: {
    severity: "warn",
    reportedWhen: "a `__DEV__` guard is written as `&&` or `?:` where an `if` would do the same thing",
    heading: (found) => `${found.length} \`__DEV__\` guard(s) written as an operator:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    \`__DEV__ ${issue.written === "&&" ? "&&" : "?"} ${issue.guarding}\` — write it as \`if (__DEV__)\`.`,
    ],
    advice:
      "`__DEV__ && publish()` does what `if (__DEV__) publish()` does, and the framework asks for the\n" +
      "`if`.\n\n" +
      "Not because the build cares. Measured with esbuild and `__DEV__: false`: the `&&` form is\n" +
      "dropped where an unminified `if (false) { … }` keeps its whole block and its strings, and with\n" +
      "minifying on — which every package here does — both vanish the same way.\n\n" +
      "The reason is that a flag with two spellings has to be read twice by everything that reads it:\n" +
      "a person grepping, somebody learning the codebase, and this checker, which reported dev-only\n" +
      "code for being written the other way until it was taught both.\n\n" +
      'Only a STATEMENT is reported. `const name = __DEV__ ? displayName(x) : ""` uses the value and\n' +
      "an `if` is no replacement for it, so it is left alone — and `if (__DEV__ && ready)` is the\n" +
      "shape being asked for, not an instance of the fault.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(file, { unlessAnnotated }) {
    const found: DevGuardAsAnExpressionIssue[] = [];

    (function scan(node: ts.Node): void {
      /**
       * An EXPRESSION STATEMENT, which is the only position an `if` can take over.
       *
       * Everything else — an initializer, a return, an argument, a JSX child — uses the value, and
       * `if` produces none.
       */
      if (ts.isExpressionStatement(node)) {
        const written = node.expression;

        if (
          ts.isBinaryExpression(written) &&
          written.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
          isDevFlag(written.left)
        ) {
          const issue = unlessAnnotated(node, () => ({
            written: "&&" as const,
            guarding: shorten(written.right),
            ...positionOf(node),
          }));
          if (issue !== undefined) found.push(issue);
        }

        if (ts.isConditionalExpression(written) && isDevFlag(written.condition)) {
          const issue = unlessAnnotated(node, () => ({
            written: "?:" as const,
            guarding: shorten(written.whenTrue),
            ...positionOf(node),
          }));
          if (issue !== undefined) found.push(issue);
        }
      }

      ts.forEachChild(node, scan);
    })(file);

    return found;
  },
} as const satisfies ModuleRule<DevGuardAsAnExpressionIssue>;
