import ts from "typescript";
import { positionOf } from "../syntax";
import { hasDecorator } from "./render-reach";
import { openingOf } from "./element";
import type { ElementRule, ElementContext } from "./rule";

/**
 * An object or array literal written straight into a component's props.
 *
 * A literal in JSX is BUILT during the render, so the child is handed a different object every
 * time — never equal to the one before it, however identical its contents. Props comparison then
 * cannot match, and the child renders again on every render of its parent, whether or not anything
 * about it changed.
 *
 * ## Measured, not reasoned about
 *
 * One `<Row conf={…} label="x" />` under a parent whose state changes for an unrelated reason,
 * counting the CHILD's renders:
 *
 * | the prop | renders after mount | after the parent re-renders |
 * |---|---|---|
 * | `conf={{ a: 1 }}` — a fresh literal | 1 | **2** |
 * | `conf={stable}` — the same object each time | 1 | **1** |
 *
 * So it is the literal and nothing else. This is the props side of `arrow-fields`, which is the
 * same fault one level in: a value rebuilt per render that comparison can never match.
 *
 * ## Why it is a warning rather than an error
 *
 * The page is right either way — the child renders again and produces the same output, and the diff
 * writes nothing to the DOM. What it costs is work, and it multiplies: a list of a thousand rows is
 * a thousand children that cannot be skipped.
 *
 * ## What is deliberately NOT reported
 *
 * **Host elements.** `<div style={{ color: "red" }}>` hands nothing to a component and no
 * comparison happens — the attribute is applied and that is the end of it. Only a COMPONENT has
 * props to compare, so only a component is asked.
 *
 * **`key` and `ref`**, which the framework reads itself rather than passing on.
 *
 * **A prop the component DECLARED with `@StableProps`.** That declaration is the answer to this
 * report, not a workaround for it: the framework then compares the prop by CONTENT and hands the
 * child back the identity it already had, so the literal at the call site costs nothing. Reporting
 * it would be reporting the fix — the same reason `RMD020` skips a declared prop at runtime.
 *
 * The declaration is read off the component the literal is handed to, resolved through the checker
 * rather than matched by name, and through the class chain: `@StableProps` merges along it, so a
 * base's list settles a subclass's props exactly as its own does.
 *
 * **A module-level `const`**, which is built once and is the documented fix — and **a helper that
 * hands back an object it holds**, which is the same fix behind a function call. The distinction
 * both times is where the literal is BUILT, not where it is written.
 *
 * **Recursion.** A helper that calls itself, directly or through another, never hands back a value
 * at all; the walk terminates on the cycle guard and reports nothing.
 *
 * ## A helper with more than one return
 *
 * If ANY path builds a literal, it is reported. A helper that hands back a held object on one
 * branch and builds a fresh one on the other really does defeat comparison whenever that branch
 * runs, and the reader is sent to a line where the literal is plainly there.
 */
export interface FreshObjectInPropsIssue {
  /** The component the prop is handed to, as written. */
  component: string;
  /** The prop's name. */
  prop: string;
  /** Which literal it is, because the advice reads differently for the two. */
  kind: "object" | "array";
  /**
   * How it is written at the call site, so the report quotes the line rather than a shape.
   *
   * A literal is not always what is on the line: `conf={local}` and `conf={makeConf()}` are the
   * same fault, and calling either of them `conf={{…}}` sends a reader looking for a brace that is
   * not there.
   */
  written: string;
  /** Where the value is built, when it is not on this line — a local, or the function that returns it. */
  builtIn: string | undefined;
  file: string;
  line: number;
  column: number;
}

/** Props the framework consumes itself, so nothing is handed on and nothing is compared. */
const NOT_PASSED_ON: ReadonlySet<string> = new Set(["key", "ref"]);

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

interface Built {
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
 * the silence contract: a
 * prop read from `this.props`, a field, a parameter, a ternary — none of those is knowable from
 * here, and a maybe is the one thing this may never report.
 */
function freshnessOf(
  expression: ts.Expression,
  resolve: ElementContext["resolve"],
  depth: number,
  seen: Set<ts.Node> = new Set(),
): Built | undefined {
  if (depth > HOPS || seen.has(expression)) return undefined;
  seen.add(expression);

  // A cast is not a defence: `makeConf() as Conf` builds the same object, and parentheses are
  // required around a concise arrow's literal, so both are peeled before anything is decided.
  const written = unwrap(expression);

  if (ts.isObjectLiteralExpression(written)) return { kind: "object", builtIn: undefined };
  if (ts.isArrayLiteralExpression(written)) return { kind: "array", builtIn: undefined };

  if (ts.isIdentifier(written)) {
    const declaration = resolve(written)?.declarations?.[0];
    if (declaration === undefined || !ts.isVariableDeclaration(declaration)) return undefined;
    // Module scope means built once, which is the fix rather than the fault. A local is built
    // again every time the function around it runs, and here that function is the render.
    if (!insideAFunction(declaration)) return undefined;
    if (declaration.initializer === undefined) return undefined;
    const inner = freshnessOf(declaration.initializer, resolve, depth + 1, seen);
    return inner === undefined ? undefined : { kind: inner.kind, builtIn: inner.builtIn ?? `\`${written.text}\`` };
  }

  if (ts.isCallExpression(written)) {
    const callee = unwrap(written.expression);
    const named = ts.isIdentifier(callee) ? callee : ts.isPropertyAccessExpression(callee) ? callee.name : undefined;
    if (named === undefined) return undefined;

    const called = functionOf(resolve(named)?.declarations?.[0]);
    if (called === undefined) return undefined;
    // A `@compute` caches its answer, so what it returns is not rebuilt.
    if (ts.isMethodDeclaration(called) && hasDecorator(called, "compute")) return undefined;

    const file = called.getSourceFile();
    if (file.isDeclarationFile || file.fileName.includes("node_modules")) return undefined;
    if (called.body === undefined) return undefined;

    // A concise arrow has no block: its body IS what it returns.
    const inner = ts.isBlock(called.body)
      ? handedBack(called.body, resolve, depth, seen)
      : freshnessOf(called.body, resolve, depth + 1, seen);
    // The inner name wins: the reader wants the function the literal is in, and the outer one is
    // already on the line they are reading.
    return inner === undefined ? undefined : { kind: inner.kind, builtIn: inner.builtIn ?? `\`${named.text}\`` };
  }

  return undefined;
}

/** The first thing a body returns that is built during the call, if any of them is. */
function handedBack(
  body: ts.Block,
  resolve: ElementContext["resolve"],
  depth: number,
  seen: Set<ts.Node>,
): Built | undefined {
  let found: Built | undefined;
  (function look(node: ts.Node): void {
    if (found !== undefined) return;
    // A nested function's returns are its own, not this one's.
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) return;
    if (ts.isReturnStatement(node) && node.expression !== undefined) {
      found = freshnessOf(node.expression, resolve, depth + 1, seen);
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

/** The written form, kept to one readable line — the report quotes the source, not a shape. */
function shorten(node: ts.Expression): string {
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

/**
 * The prop names a component declared with `@StableProps`, its bases included.
 *
 * Resolved rather than matched by name — a class whose name happens to equal this one's is a
 * different class — and the chain is walked because `@StableProps` merges along it: a base that
 * declares `filter` settles it for every subclass, which is the behaviour the decorator promises.
 *
 * Bounded at four hops and cycle-guarded, the same as everywhere else this package follows a
 * heritage chain.
 */
function stablePropsOf(tagName: ts.Node, resolve: ElementContext["resolve"]): ReadonlySet<string> {
  const found = new Set<string>();
  const seen = new Set<ts.Node>();

  let declaration = resolve(tagName)?.declarations?.find((one): one is ts.ClassDeclaration =>
    ts.isClassDeclaration(one),
  );

  for (let hop = 0; hop < 4 && declaration !== undefined && !seen.has(declaration); hop++) {
    seen.add(declaration);

    for (const decorator of ts.getDecorators(declaration) ?? []) {
      const call = decorator.expression;
      if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) continue;
      if (call.expression.text !== "StableProps") continue;
      for (const argument of call.arguments) {
        if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) found.add(argument.text);
      }
    }

    const base = declaration.heritageClauses?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)?.types[0]
      ?.expression;
    if (base === undefined || (!ts.isIdentifier(base) && !ts.isPropertyAccessExpression(base))) break;
    declaration = resolve(base)?.declarations?.find((one): one is ts.ClassDeclaration => ts.isClassDeclaration(one));
  }

  return found;
}

export const freshObjectInProps = {
  id: "fresh-object-in-props",

  report: {
    severity: "warn",
    reportedWhen:
      "a component is handed an object or array built during the render — written in the attribute, in a local one line up, or by a helper it calls — so it is a new value every time and comparison can never match",
    heading: (found) => `${found.length} prop(s) rebuilt on every render:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component} ${issue.prop}={${issue.written}}> is a new ${issue.kind} every render${
        issue.builtIn === undefined ? "" : `, built in ${issue.builtIn}`
      }, so <${issue.component}> re-renders whenever its parent does.`,
    ],
    advice:
      "A literal written in JSX is built during the render, so the child is handed a different\n" +
      "object every time — never equal to the one before it, however identical its contents.\n" +
      "Comparison cannot match, and the child renders again whenever its parent does, whether or\n" +
      "not anything about it changed. Measured: one child goes from one render to two; a list of a\n" +
      "thousand rows is a thousand children that cannot be skipped.\n\n" +
      "Moving the literal does not fix it. A `const` at the top of `render()` and a helper that\n" +
      "returns a literal are the same object built at the same moment, and both are reported.\n\n" +
      "Where the value never changes, lift it out of the render — a module constant, or a field on\n" +
      "the class. Where it is derived from state or props, a `@compute` gives you the same value\n" +
      "back until something it reads changes, which is exactly what comparison needs.\n\n" +
      "Where the literal is the API you want, the CHILD can declare the prop a value with\n" +
      '`@StableProps("conf")`. The framework then compares it by content and hands the child back\n' +
      "the identity it already had, and this stops reporting the call site.\n\n" +
      "The page is correct either way, which is why this is a warning: what it costs is work, not\n" +
      "output. `<div style={{…}}>` is NOT reported — a host element hands nothing to a component,\n" +
      "so there is nothing to compare.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(element, { tag, resolve }) {
    // A host element has no props to compare. `tag` is `undefined` exactly when this names a
    // component, which is the only case with a comparison to defeat.
    if (tag !== undefined) return [];

    const opening = openingOf(element);
    const component = opening.tagName.getText();
    const settled = stablePropsOf(opening.tagName, resolve);
    const found: FreshObjectInPropsIssue[] = [];

    for (const attribute of opening.attributes.properties) {
      if (!ts.isJsxAttribute(attribute)) continue;

      const name = attribute.name.getText();
      if (NOT_PASSED_ON.has(name)) continue;
      if (settled.has(name)) continue;

      const value = attribute.initializer;
      if (value === undefined || !ts.isJsxExpression(value) || value.expression === undefined) continue;

      const built = freshnessOf(value.expression, resolve, 0);
      if (built === undefined) continue;

      found.push({
        component,
        prop: name,
        kind: built.kind,
        written: shorten(value.expression),
        builtIn: built.builtIn,
        ...positionOf(attribute),
      });
    }

    return found;
  },
} as const satisfies ElementRule<FreshObjectInPropsIssue>;
