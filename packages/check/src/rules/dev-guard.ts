import ts from "typescript";

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
  let child: ts.Node = node;

  for (let at = node.parent; at !== undefined; child = at, at = at.parent) {
    // The THEN branch only: arriving through the `else` of a dev guard is arriving from production.
    if (ts.isIfStatement(at) && at.thenStatement === child && guardsDev(at.expression)) return true;

    /**
     * `__DEV__ && doSomething()` — the same claim written as an expression.
     *
     * Reading only the `if` reported the identical code written the other way, which is this
     * repository's standing lesson: a fix for one spelling is not a fix for the other. The RIGHT
     * operand only — the left is the guard itself.
     */
    if (ts.isBinaryExpression(at) && at.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      if (at.right === child && guardsDev(at.left)) return true;
    }

    // `__DEV__ ? here : there` — the same claim again, and only the arm the guard chooses.
    if (ts.isConditionalExpression(at) && at.whenTrue === child && guardsDev(at.condition)) return true;
  }
  return false;
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
  // `&&` only. Every branch of one has to hold, so `__DEV__` anywhere in it decides.
  if (ts.isBinaryExpression(condition) && condition.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return guardsDev(condition.left) || guardsDev(condition.right);
  }
  return false;
}
