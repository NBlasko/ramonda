import ts from "typescript";

/**
 * Whether a node only runs when some CONDITION held — whatever that condition is about.
 *
 * Two rules ask this shape about two different flags. `dev-guard` asks whether code is DEV-ONLY;
 * `side-guard` asks whether it runs on the SERVER or in the browser. The flags differ and the walk
 * does not, so the walk lives here once — which is this package's standing lesson about readers,
 * and it arrived late enough that the second copy had already been written.
 *
 * Both predicates are needed rather than one and a negation, because a condition can say three
 * things: this, the opposite of this, or nothing. `typeof window === "undefined"` means the server;
 * `flag` means neither until somebody says what `flag` is. A walk that inverted one predicate would
 * read every unrecognised condition as proof of the opposite.
 */
export interface Means {
  /** The condition holding means the guarded code runs. */
  holds(condition: ts.Expression): boolean;
  /** The condition holding means it does NOT — the `else`, the false arm, the early return. */
  denies(condition: ts.Expression): boolean;
}

/**
 * The four shapes a guard is written in.
 *
 * Three of them climb: the THEN branch of an `if`, the RIGHT of an `&&`, and the chosen arm of a
 * ternary — each also in its inverted form, since `if (not-this) … else <here>` narrows exactly as
 * `if (this) <here>` does.
 *
 * The fourth is the EARLY RETURN, and it is the one a walk written for `__DEV__` never needed:
 * dev-only code goes INSIDE its guard, while isomorphic code and a `render()` are written
 * `if (!ok) return null;` and then carry on. Measured on plants for both flags — it was the shape
 * each rule was silent on.
 */
export function guardedBy(node: ts.Node, means: Means): boolean {
  let child: ts.Node = node;

  for (let at = node.parent; at !== undefined; child = at, at = at.parent) {
    if (ts.isIfStatement(at)) {
      if (at.thenStatement === child && means.holds(at.expression)) return true;
      if (at.elseStatement === child && means.denies(at.expression)) return true;
    }

    // `__DEV__ && publish()` — the same claim written as an expression. The RIGHT operand only:
    // the left is the guard itself.
    if (ts.isBinaryExpression(at) && at.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      if (at.right === child && means.holds(at.left)) return true;
    }

    if (ts.isConditionalExpression(at)) {
      if (at.whenTrue === child && means.holds(at.condition)) return true;
      if (at.whenFalse === child && means.denies(at.condition)) return true;
    }

    if (ts.isBlock(at) && ts.isStatement(child) && leavesEarlyBefore(at, child, means)) return true;
  }
  return false;
}

/**
 * `if (<the opposite>) return;` somewhere ABOVE this statement in the same block.
 *
 * Only a guard that LEAVES counts — `return` or `throw`, and with no `else`, because an `if` with
 * an else does not fall through to here on that path at all. Anything else above this statement is
 * not a narrowing, and reading it as one would excuse the very thing the rule is about.
 */
function leavesEarlyBefore(block: ts.Block, statement: ts.Statement, means: Means): boolean {
  for (const above of block.statements) {
    if (above === statement) return false;
    if (!ts.isIfStatement(above) || above.elseStatement !== undefined) continue;
    if (!means.denies(above.expression)) continue;
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
