import ts from "typescript";
import { hasDecorator } from "./render-reach";
import type { ElementContext } from "./rule";

/**
 * Following a value back to where it was BUILT.
 *
 * Written for `fresh-object-in-props` and lifted out at the third rule that needed it, which is
 * where a shared walk stops being a guess. The question every one of them asks is the same: what is
 * really behind this expression — not what TYPE it has, which this package never asks, but which
 * DECLARATION it came from.
 *
 * `conf={{ dense: true }}`, `conf={local}`, `conf={makeConf()}` and `conf={flag ? {…} : STABLE}` are
 * one fault written four ways, and each of the three beyond the first was a total miss until it was
 * planted. So the walk follows an identifier to its declaration, a call into the function it names
 * and through its returns, and both sides of a branch — across files, because `resolve` follows an
 * import.
 */

/** Operators that hand back one side or the other, so a literal on either side is built. */
const CHOOSES: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
]);

/**
 * How far the walk follows a value before it gives up.
 *
 * Set past anything anyone writes on purpose. A low bound looks careful and is not: giving up after
 * three hops means a chain of four helpers is silently declared fine, and silence there is
 * indistinguishable from a clean codebase. Cost is not the reason to keep it low either — a hop is
 * one symbol resolve and one walk of one function body, and the whole rule costs milliseconds on a
 * project of 4,000 components.
 *
 * What stops a runaway is the CYCLE GUARD, not this number: mutual recursion terminates because
 * every expression is visited once. This is only a floor under pathological generated code.
 */
const HOPS = 20;

export interface Built {
  kind: "object" | "array";
  /** Where it is built, when that is not the line the prop is on. */
  builtIn: string | undefined;
}

/**
 * Whether this expression is a value BUILT during the render — an object or an array that did not
 * exist before it ran, and so can never compare equal to the one the child already has.
 *
 * Three shapes, and the two beyond the first were found by planting them: the literal is the one
 * people write first, and it is not the one that survives a refactor.
 *
 * - **Written in the attribute.** `conf={{ dense: true }}`.
 * - **A LOCAL one line up.** `const conf = { dense: true }` at the top of `render()` is the same
 *   object built at the same moment, moved for readability. Only a local counts: a module-level
 *   `const` is built ONCE, which is the documented fix and must stay silent.
 * - **A BRANCH with one on either side.** `conf={flag ? { dense: true } : STABLE}` and
 *   `conf={this.conf ?? { dense: true }}` build on the path they take, and that path is the fault.
 * - **A CALL that builds one.** `conf={makeConf()}`, wherever `makeConf` lives — `resolve` follows
 *   the import, and follows it again through a helper that calls a helper. Only when what comes
 *   back is a literal built INSIDE the chain: one handing back an object it HOLDS is a stable
 *   reference, and reporting that would report the fix again. A helper written as an arrow is the
 *   same helper, so `const makeConf = () => ({…})` is followed exactly as a `function` is.
 *
 * The name in the report is the function the literal is actually IN, not the one on the line —
 * `conf={chainConf()}` already says `chainConf`, and what a reader needs is where to go next.
 *
 * A `@compute` getter is never followed, and does not need to be — it is read as a PROPERTY, not
 * called — but a `@compute` reached any other way is skipped explicitly, because caching is the
 * whole of what it does.
 *
 * Cycle-guarded, and bounded at `HOPS` — set deeper than hand-written code goes, because a chain
 * the walk abandons is reported as nothing at all. Everything else answers `undefined`, which is
 * the silence contract: a prop read from `this.props`, a field, a parameter — none of those is
 * knowable from here, and a maybe is the one thing this may never report.
 */
export function freshnessOf(
  expression: ts.Expression,
  resolve: ElementContext["resolve"],
  depth: number,
  seen: Set<ts.Node> = new Set(),
): Built | undefined {
  const found = follow(expression, resolve, REBUILT, depth, seen);
  return found === undefined ? undefined : { kind: found.value, builtIn: found.foundIn };
}

/**
 * What the walk is looking for, and how far it may look.
 *
 * The two questions that use this differ in both, and neither difference is cosmetic. One asks
 * whether a value is REBUILT — so a module-level `const` is the fix rather than the fault and must
 * not be followed to. The other asks what a value certainly IS — and a module-level object is still
 * an object, still unkeyable, still a fault.
 */
export interface Looking<T> {
  /** What this expression certainly is, when the source says so; `undefined` to keep walking. */
  leaf(expression: ts.Expression): T | undefined;
  /** Whether a value declared at module scope counts, or the walk stops at the module boundary. */
  throughModuleScope: boolean;
}

/** Looking for a value REBUILT during the render: only a literal, and only inside a function. */
const REBUILT: Looking<"object" | "array"> = {
  leaf: (expression) =>
    ts.isObjectLiteralExpression(expression) ? "object" : ts.isArrayLiteralExpression(expression) ? "array" : undefined,
  throughModuleScope: false,
};

/** What the walk found, and the name of the local or function it was found in. */
export interface Found<T> {
  value: T;
  /** Where it is, when that is not the line the expression is on — a local, or a function. */
  foundIn: string | undefined;
}

/**
 * Follows an expression to the declaration behind it, until `how.leaf` recognises what it is.
 *
 * Four shapes, and the three beyond the first were each found by PLANTING them — the literal is
 * what people write first and it is not what survives a refactor.
 *
 * - **Written where it is used.** `conf={{ dense: true }}`.
 * - **A LOCAL one line up.** `const conf = { dense: true }` at the top of `render()` is the same
 *   object built at the same moment, moved for readability.
 * - **A BRANCH with one on either side.** `flag ? { dense: true } : STABLE`, `this.conf ?? {…}`.
 *   Either side counts: a value built on the path taken is built.
 * - **A CALL that produces one.** `makeConf()`, wherever `makeConf` lives — `resolve` follows the
 *   import, and follows it again through a helper that calls a helper. Only when what comes back is
 *   built INSIDE the chain: one handing back an object it HOLDS is a stable reference. A helper
 *   written as an arrow is the same helper, so `const makeConf = () => ({…})` is followed too.
 *
 * `foundIn` names the INNERMOST place, not the outermost — `chainConf()` is already on the line the
 * reader is looking at, and what they need is where to go next.
 *
 * A `@compute` reached through a call is skipped, because caching is the whole of what it does. (It
 * is normally read as a PROPERTY and never reaches here at all.)
 *
 * Cycle-guarded, and bounded at `HOPS` — set deeper than hand-written code goes, because a chain
 * the walk abandons is reported as NOTHING, and nothing is what a clean codebase looks like.
 * Everything else answers `undefined`, which is the silence contract: a value read from
 * `this.props`, a field, a parameter — none of those is knowable from here, and a maybe is the one
 * thing this package may never report.
 */
export function follow<T>(
  expression: ts.Expression,
  resolve: ElementContext["resolve"],
  how: Looking<T>,
  depth = 0,
  seen: Set<ts.Node> = new Set(),
): Found<T> | undefined {
  if (depth > HOPS || seen.has(expression)) return undefined;
  seen.add(expression);

  // A cast is not a defence: `makeConf() as Conf` builds the same object, and parentheses are
  // required around a concise arrow's literal, so both are peeled before anything is decided.
  const written = unwrap(expression);

  const leaf = how.leaf(written);
  if (leaf !== undefined) return { value: leaf, foundIn: undefined };

  if (ts.isIdentifier(written)) {
    const declaration = resolve(written)?.declarations?.[0];
    if (declaration === undefined || !ts.isVariableDeclaration(declaration)) return undefined;
    // Module scope means built ONCE. For "is this rebuilt" that is the fix rather than the fault
    // and the walk stops; for "what is this" it changes nothing and the walk goes on.
    if (!how.throughModuleScope && !insideAFunction(declaration)) return undefined;
    if (declaration.initializer === undefined) return undefined;
    const inner = follow(declaration.initializer, resolve, how, depth + 1, seen);
    return inner === undefined ? undefined : { value: inner.value, foundIn: inner.foundIn ?? `\`${written.text}\`` };
  }

  if (ts.isConditionalExpression(written)) {
    return (
      follow(written.whenTrue, resolve, how, depth + 1, seen) ??
      follow(written.whenFalse, resolve, how, depth + 1, seen)
    );
  }

  if (ts.isBinaryExpression(written) && CHOOSES.has(written.operatorToken.kind)) {
    return follow(written.left, resolve, how, depth + 1, seen) ?? follow(written.right, resolve, how, depth + 1, seen);
  }

  if (ts.isCallExpression(written)) {
    const callee = unwrap(written.expression);
    const named = ts.isIdentifier(callee) ? callee : ts.isPropertyAccessExpression(callee) ? callee.name : undefined;
    if (named === undefined) return undefined;

    const called = functionOf(resolve(named)?.declarations?.[0]);
    if (called === undefined) return undefined;
    if (ts.isMethodDeclaration(called) && hasDecorator(called, "compute")) return undefined;

    const file = called.getSourceFile();
    if (file.isDeclarationFile || file.fileName.includes("node_modules")) return undefined;
    if (called.body === undefined) return undefined;

    // A concise arrow has no block: its body IS what it returns.
    const inner = ts.isBlock(called.body)
      ? handedBack(called.body, resolve, how, depth, seen)
      : follow(called.body, resolve, how, depth + 1, seen);
    return inner === undefined ? undefined : { value: inner.value, foundIn: inner.foundIn ?? `\`${named.text}\`` };
  }

  return undefined;
}

/** The first thing a body hands back that the walk recognises, if any of them is. */
function handedBack<T>(
  body: ts.Block,
  resolve: ElementContext["resolve"],
  how: Looking<T>,
  depth: number,
  seen: Set<ts.Node>,
): Found<T> | undefined {
  let found: Found<T> | undefined;
  (function look(node: ts.Node): void {
    if (found !== undefined) return;
    // A nested function's returns are its own, not this one's.
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) return;
    if (ts.isReturnStatement(node) && node.expression !== undefined) {
      found = follow(node.expression, resolve, how, depth + 1, seen);
      if (found !== undefined) return;
    }
    ts.forEachChild(node, look);
  })(body);
  return found;
}

/**
 * The function a name stands for, whether it was written as one or assigned as a value.
 *
 * `const makeConf = () => ({…})` is the same helper as `function makeConf() { … }` and was found by
 * planting it: only the `function` form was followed, so writing the helper the other way silenced
 * the rule completely.
 */
function functionOf(
  declaration: ts.Declaration | undefined,
): ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction | undefined {
  if (declaration === undefined) return undefined;
  if (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)) return declaration;
  if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
    const assigned = unwrap(declaration.initializer);
    if (ts.isArrowFunction(assigned) || ts.isFunctionExpression(assigned)) return assigned;
  }
  return undefined;
}

/** Parentheses and the type-only wrappers around an expression, none of which change the value. */
function unwrap(expression: ts.Expression): ts.Expression {
  let at = expression;
  while (
    ts.isParenthesizedExpression(at) ||
    ts.isAsExpression(at) ||
    ts.isSatisfiesExpression(at) ||
    ts.isNonNullExpression(at) ||
    ts.isTypeAssertionExpression(at)
  ) {
    at = at.expression;
  }
  return at;
}

/**
 * The first expression a function hands back, whether it has a block or not.
 *
 * Shared, because three rules now ask it of three different callbacks — a helper that builds a
 * value, a hook's props factory, and a `@watchProp` selector — and a fourth copy would be a fourth
 * chance to forget that a concise arrow has no `return` at all.
 *
 * A nested function's returns are its own and are not read as this one's.
 */
export function returnedBy(fn: ts.ArrowFunction | ts.FunctionExpression): ts.Expression | undefined {
  if (!ts.isBlock(fn.body)) return fn.body;

  let found: ts.Expression | undefined;
  (function look(node: ts.Node): void {
    if (found !== undefined) return;
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) return;
    if (ts.isReturnStatement(node) && node.expression !== undefined) {
      found = node.expression;
      return;
    }
    ts.forEachChild(node, look);
  })(fn.body);
  return found;
}

/** The written form, kept to one readable line — the report quotes the source, not a shape. */
export function shorten(node: ts.Expression): string {
  const text = node.getText().replace(/\s+/g, " ");
  return text.length <= 32 ? text : `${text.slice(0, 29)}…`;
}

/** Whether a declaration sits inside a function body rather than at the top of a module. */
function insideAFunction(node: ts.Node): boolean {
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    if (
      ts.isFunctionDeclaration(at) ||
      ts.isFunctionExpression(at) ||
      ts.isArrowFunction(at) ||
      ts.isMethodDeclaration(at) ||
      ts.isGetAccessorDeclaration(at) ||
      ts.isConstructorDeclaration(at)
    ) {
      return true;
    }
    if (ts.isSourceFile(at)) return false;
  }
  return false;
}
