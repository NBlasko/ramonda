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
 * every branch of an `&&` has to be true for the body to run. A `||` does not count: `__DEV__ || x`
 * runs in production whenever `x` does. Neither does `!__DEV__`, nor the `else` of a dev guard,
 * which is the production half.
 */
export function insideADevGuard(node: ts.Node): boolean {
  let child: ts.Node = node;

  for (let at = node.parent; at !== undefined; child = at, at = at.parent) {
    // The THEN branch only: arriving through the `else` of a dev guard is arriving from production.
    if (ts.isIfStatement(at) && at.thenStatement === child && guardsDev(at.expression)) return true;
  }
  return false;
}

/** Whether this condition being true means the build is a development one. */
function guardsDev(condition: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(condition)) return guardsDev(condition.expression);
  if (ts.isIdentifier(condition)) return condition.text === "__DEV__";
  // `&&` only. Every branch of one has to hold, so `__DEV__` anywhere in it decides.
  if (ts.isBinaryExpression(condition) && condition.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return guardsDev(condition.left) || guardsDev(condition.right);
  }
  return false;
}
