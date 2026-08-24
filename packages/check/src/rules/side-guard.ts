import ts from "typescript";

/**
 * Whether a read sits behind a check that it only happens on the side where it works.
 *
 * `process` does not exist in a browser and `window` does not exist on a server, so isomorphic code
 * asks before it touches either — and asking is the CORRECT way to write it. Every rule about a
 * one-sided global has to know that, or it reports the fix.
 *
 * Measured on `fixtures/env-guards` before this existed: `server-env-in-shared-code`, which is an
 * ERROR, reported five shapes that do not crash, including the two most standard ways anybody
 * writes this — `typeof process !== "undefined"` and `if (typeof window === "undefined")`. A build
 * failing against correct code is the one thing this package cannot afford.
 *
 * Deliberately built alongside {@link insideADevGuard} rather than folded into it. The two ask
 * different questions — "is this build a development one" and "is this side the server" — and the
 * shapes they accept differ: this one has to read an EARLY RETURN, which a dev guard never needs
 * because dev-only code is written inside its guard rather than after it.
 */

/** Which side a piece of code has been narrowed to. */
export type Side = "server" | "client";

/** The other one. */
const opposite = (side: Side): Side => (side === "server" ? "client" : "server");

/**
 * `typeof process`, `typeof window`, `typeof document` — the existence test, and which side it
 * proves when it holds.
 *
 * By NAME and not by resolution, and that is right here rather than lazy: `typeof` on an undeclared
 * identifier is the one expression in the language that cannot throw, so a reader writing this is
 * asking about the GLOBAL whatever else is in scope. A local called `process` would make the guard
 * meaningless, and it would also make the read beside it meaningless, so the pair stays consistent.
 */
const PROVES: Record<string, Side> = {
  process: "server",
  window: "client",
  document: "client",
  navigator: "client",
  localStorage: "client",
};

/** `typeof x === "undefined"` and its three other spellings, as `{ name, exists }`. */
function existenceTest(condition: ts.Expression): { side: Side; exists: boolean } | undefined {
  if (!ts.isBinaryExpression(condition)) return undefined;
  const kind = condition.operatorToken.kind;
  const equals =
    kind === ts.SyntaxKind.EqualsEqualsEqualsToken || kind === ts.SyntaxKind.EqualsEqualsToken
      ? true
      : kind === ts.SyntaxKind.ExclamationEqualsEqualsToken || kind === ts.SyntaxKind.ExclamationEqualsToken
        ? false
        : undefined;
  if (equals === undefined) return undefined;

  // Either way round: `typeof process !== "undefined"` and `"undefined" !== typeof process`.
  const sides = [
    [condition.left, condition.right],
    [condition.right, condition.left],
  ] as const;
  for (const [typeofSide, literalSide] of sides) {
    if (!ts.isTypeOfExpression(typeofSide) || !ts.isIdentifier(typeofSide.expression)) continue;
    if (!ts.isStringLiteralLike(literalSide) || literalSide.text !== "undefined") continue;
    const side = PROVES[typeofSide.expression.text];
    if (side === undefined) continue;
    // `=== "undefined"` means it is NOT there, so it proves the OTHER side.
    return equals ? { side: opposite(side), exists: false } : { side, exists: true };
  }
  return undefined;
}

/** `import.meta.env.SSR` — the bundler's own flag, `true` only in the server build. */
function isSsrFlag(condition: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(condition) &&
    condition.name.text === "SSR" &&
    ts.isPropertyAccessExpression(condition.expression) &&
    condition.expression.name.text === "env" &&
    ts.isMetaProperty(condition.expression.expression)
  );
}

/**
 * Whether this condition holding means the code below it runs on `side`.
 *
 * `&&` counts, either way round, because every branch of one has to hold. `||` does not: it holds
 * whenever EITHER side does, so it proves nothing about which one. `!` inverts.
 */
export function narrowsTo(condition: ts.Expression, side: Side): boolean {
  if (ts.isParenthesizedExpression(condition)) return narrowsTo(condition.expression, side);

  if (ts.isPrefixUnaryExpression(condition) && condition.operator === ts.SyntaxKind.ExclamationToken) {
    return narrowsTo(condition.operand, opposite(side));
  }

  if (isSsrFlag(condition)) return side === "server";

  const test = existenceTest(condition);
  if (test !== undefined) return test.side === side;

  if (ts.isBinaryExpression(condition) && condition.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return narrowsTo(condition.left, side) || narrowsTo(condition.right, side);
  }
  return false;
}

/**
 * Whether this node only runs on `side`, because something above it or before it says so.
 *
 * Three climbing shapes, the same three {@link insideADevGuard} takes — the THEN branch of an `if`,
 * the RIGHT of an `&&`, the chosen arm of a ternary — each also in its inverted form, because
 * `if (client) … else <here>` narrows to the server exactly as `if (server) <here>` does.
 *
 * And one shape a dev guard never needs: the EARLY RETURN. `if (typeof process === "undefined")
 * return null;` narrows everything after it in the same block, and it is how a `render()` is
 * written far more often than a nested `if` is — measured on the plant, it was one of the five
 * correct shapes being reported.
 */
export function narrowedTo(node: ts.Node, side: Side): boolean {
  let child: ts.Node = node;

  for (let at = node.parent; at !== undefined; child = at, at = at.parent) {
    if (ts.isIfStatement(at)) {
      if (at.thenStatement === child && narrowsTo(at.expression, side)) return true;
      // The `else` of a check for the OTHER side is this side.
      if (at.elseStatement === child && narrowsTo(at.expression, opposite(side))) return true;
    }

    if (ts.isBinaryExpression(at) && at.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      if (at.right === child && narrowsTo(at.left, side)) return true;
    }

    if (ts.isConditionalExpression(at)) {
      if (at.whenTrue === child && narrowsTo(at.condition, side)) return true;
      if (at.whenFalse === child && narrowsTo(at.condition, opposite(side))) return true;
    }

    if (ts.isBlock(at) && ts.isStatement(child) && leavesEarlyBefore(at, child, side)) return true;
  }
  return false;
}

/**
 * `if (<the other side>) return;` somewhere ABOVE this statement in the same block.
 *
 * Only a guard that LEAVES counts — `return` or `throw`, and with no `else`, because an `if` with
 * an else does not fall through to here at all on that path. Anything else above this statement is
 * not a narrowing, and reading it as one would excuse a real crash.
 */
function leavesEarlyBefore(block: ts.Block, statement: ts.Statement, side: Side): boolean {
  for (const above of block.statements) {
    if (above === statement) return false;
    if (!ts.isIfStatement(above) || above.elseStatement !== undefined) continue;
    if (!narrowsTo(above.expression, opposite(side))) continue;
    if (leaves(above.thenStatement)) return true;
  }
  return false;
}

/** Whether this statement cannot fall through to the line below it. */
function leaves(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) return true;
  // `{ return null; }` — the braced form, which is what a formatter writes.
  if (!ts.isBlock(statement)) return false;
  return statement.statements.some(leaves);
}
