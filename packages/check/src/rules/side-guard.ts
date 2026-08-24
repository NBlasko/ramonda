import ts from "typescript";
import { guardedBy } from "./guard-walk";

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
 * The shapes are {@link guardedBy}'s, shared with the dev guard — this file only says what the
 * CONDITIONS mean. Written with its own copy of the walk first, and the copy was the mistake: the
 * dev guard turned out to need the early return too, and one of the two would have got it.
 */
export function narrowedTo(node: ts.Node, side: Side): boolean {
  return guardedBy(node, {
    holds: (condition) => narrowsTo(condition, side),
    denies: (condition) => narrowsTo(condition, opposite(side)),
  });
}
