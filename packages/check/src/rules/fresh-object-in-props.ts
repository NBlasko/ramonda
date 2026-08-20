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
 *   the import. Only when what it returns is a literal built INSIDE it: a helper handing back an
 *   object it holds is a stable reference, and reporting that would report the fix again.
 *
 * A `@compute` getter is never followed, and does not need to be — it is read as a PROPERTY, not
 * called — but a `@compute` reached any other way is skipped explicitly, because caching is the
 * whole of what it does.
 *
 * Bounded and cycle-guarded. Everything else answers `undefined`, which is the silence contract: a
 * prop read from `this.props`, a field, a parameter, a ternary — none of those is knowable from
 * here, and a maybe is the one thing this may never report.
 */
function freshnessOf(
  written: ts.Expression,
  resolve: ElementContext["resolve"],
  depth: number,
  seen: Set<ts.Node> = new Set(),
): Built | undefined {
  if (depth > 3 || seen.has(written)) return undefined;
  seen.add(written);

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
    const callee = written.expression;
    const named = ts.isIdentifier(callee) ? callee : ts.isPropertyAccessExpression(callee) ? callee.name : undefined;
    if (named === undefined) return undefined;

    const declaration = resolve(named)?.declarations?.[0];
    if (declaration === undefined) return undefined;
    if (!ts.isFunctionDeclaration(declaration) && !ts.isMethodDeclaration(declaration)) return undefined;
    // A `@compute` caches its answer, so what it returns is not rebuilt.
    if (ts.isMethodDeclaration(declaration) && hasDecorator(declaration, "compute")) return undefined;

    const file = declaration.getSourceFile();
    if (file.isDeclarationFile || file.fileName.includes("node_modules")) return undefined;
    if (declaration.body === undefined) return undefined;

    let inner: Built | undefined;
    (function look(node: ts.Node): void {
      if (inner !== undefined) return;
      // A nested function's returns are its own, not this one's.
      if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) return;
      if (ts.isReturnStatement(node) && node.expression !== undefined) {
        inner = freshnessOf(node.expression, resolve, depth + 1, seen);
        if (inner !== undefined) return;
      }
      ts.forEachChild(node, look);
    })(declaration.body);
    return inner === undefined ? undefined : { kind: inner.kind, builtIn: `\`${named.text}\`` };
  }

  return undefined;
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
