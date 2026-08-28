import ts from "typescript";
import { guardedBy } from "./guard-walk";

/**
 * Whether a site is inside `if (__DEV__)`, and so is not in a production build at all.
 *
 * `__DEV__` is the framework's own contract, documented and relied on everywhere: core, lens, query
 * and form are each built twice, and `ramondaDefine({ __DEV__: "false" })` is what an application's
 * production build passes. Measured in `packages/query/dist/index.prod.js` — the three methods that
 * publish a client to the devtools panel compile to `publishToDevtools(){}republish(){}` and the
 * listener they add does not exist.
 *
 * ## Why this is an escape a rule can trust, and a comment is not
 *
 * A `ramonda-check-ignore` is the AUTHOR's claim about a line. This is a fact about the build: put
 * code behind `__DEV__` and production genuinely does not have it, whatever anybody says about it.
 * That matters for anything that reads a project's findings as a measure of it — an annotation can
 * be sprinkled to make a number go up, and a `__DEV__` guard cannot, because the only way to get it
 * is to make the code really vanish.
 *
 * ## What counts, and what deliberately does not
 *
 * `if (__DEV__)` and `if (__DEV__ && env === "client")` — a conjunction, either way round, because
 * every branch of an `&&` has to be true for the body to run. The bare expression forms count too:
 * `__DEV__ && doSomething()` and `__DEV__ ? here : there`. Neither is how this repository writes
 * one — measured, zero of them in statement position against 149 written `if (__DEV__ && …)`, which
 * is a conjunction inside an `if` and the shape `dev-guard-as-an-expression` asks for. They are
 * accepted here anyway: whether code is DEV-ONLY and whether it is written well are two questions,
 * and answering the first with a silence would double-report the second.
 *
 * A `||` does not count: `__DEV__ || x` runs in production whenever `x` does. Neither does
 * `!__DEV__`, nor the `else` of a dev guard, nor the false arm of a ternary — those are the
 * production half.
 */
export function insideADevGuard(node: ts.Node): boolean {
  return guardedBy(node, { holds: guardsDev, denies: deniesDev });
}

/**
 * Whether this condition holding means the build is NOT a development one.
 *
 * The `else` of a dev guard, the false arm of its ternary, and — the shape this walk was silent on
 * — `if (!__DEV__) return;`, which narrows everything after it. Measured on a plant:
 * `listener-added-by-hand` reported a correctly guarded dev-only listener written that way, and
 * told its author to reach for a decorator that cannot be dev-only.
 *
 * A separate predicate rather than `!guardsDev(…)`, because a condition can say three things and
 * not two: this, the opposite, or nothing at all. Inverting would read every unrecognised
 * condition as proof that the build is production.
 */
function deniesDev(condition: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(condition)) return deniesDev(condition.expression);
  if (ts.isPrefixUnaryExpression(condition) && condition.operator === ts.SyntaxKind.ExclamationToken) {
    return guardsDev(condition.operand);
  }
  // `import.meta.env.PROD` is the other half of the bundler's own pair, and says so directly.
  return isBundlerFlag(condition, "PROD");
}

/**
 * Whether this condition being true means the build is a development one.
 *
 * Exported because `dev-guard-as-an-expression` asks the same thing about the same flag, and asked
 * it more narrowly — it required the flag to be the immediate left of the `&&`, so
 * `__DEV__ && ready && publish()` was a guard here and not a guard there. Two answers about one
 * flag is the drift this whole helper exists to prevent.
 */
export function guardsDev(condition: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(condition)) return guardsDev(condition.expression);
  if (ts.isIdentifier(condition)) return condition.text === "__DEV__";
  /**
   * `import.meta.env.DEV` — the bundler's own flag, and the same fact under another name.
   *
   * `__DEV__` is the spelling this repository asks for and documents, and it is defined for apps
   * through `ramondaDefine`. It is not the only one available: `import.meta.env.DEV` is a built-in
   * every bundler provides, and somebody arriving from one reaches for it without thinking. Not
   * accepting it meant reporting their correctly guarded dev-only code — measured on a plant — and
   * a rule that reports the fix is worse than a rule that tolerates a second spelling.
   */
  if (isBundlerFlag(condition, "DEV")) return true;
  if (ts.isPrefixUnaryExpression(condition) && condition.operator === ts.SyntaxKind.ExclamationToken) {
    return isBundlerFlag(condition.operand, "PROD");
  }
  // `&&` only. Every branch of one has to hold, so `__DEV__` anywhere in it decides.
  if (ts.isBinaryExpression(condition) && condition.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return guardsDev(condition.left) || guardsDev(condition.right);
  }
  return false;
}

/** `import.meta.env.DEV` / `.PROD` — the two the bundler defines itself. */
function isBundlerFlag(condition: ts.Expression, name: "DEV" | "PROD"): boolean {
  return (
    ts.isPropertyAccessExpression(condition) &&
    condition.name.text === name &&
    ts.isPropertyAccessExpression(condition.expression) &&
    condition.expression.name.text === "env" &&
    ts.isMetaProperty(condition.expression.expression)
  );
}
