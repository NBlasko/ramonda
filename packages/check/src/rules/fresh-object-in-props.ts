import ts from "typescript";
import { positionOf } from "../syntax";
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
 */
export interface FreshObjectInPropsIssue {
  /** The component the prop is handed to, as written. */
  component: string;
  /** The prop's name. */
  prop: string;
  /** Which literal it is, because the advice reads differently for the two. */
  kind: "object" | "array";
  file: string;
  line: number;
  column: number;
}

/** Props the framework consumes itself, so nothing is handed on and nothing is compared. */
const NOT_PASSED_ON: ReadonlySet<string> = new Set(["key", "ref"]);

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
      "an object or array literal is written into a component's props, so it is a new value every render and comparison can never match",
    heading: (found) => `${found.length} prop(s) rebuilt on every render:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component} ${issue.prop}={${issue.kind === "object" ? "{…}" : "[…]"}}> is a new ${issue.kind} ` +
        `every render, so <${issue.component}> re-renders whenever its parent does.`,
    ],
    advice:
      "A literal written in JSX is built during the render, so the child is handed a different\n" +
      "object every time — never equal to the one before it, however identical its contents.\n" +
      "Comparison cannot match, and the child renders again whenever its parent does, whether or\n" +
      "not anything about it changed. Measured: one child goes from one render to two; a list of a\n" +
      "thousand rows is a thousand children that cannot be skipped.\n\n" +
      "Where the value never changes, lift it out of the render — a module constant, or a field on\n" +
      "the class. Where it is derived from state or props, a `@compute` gives you the same value\n" +
      "back until something it reads changes, which is exactly what comparison needs.\n\n" +
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

      const written = value.expression;
      const kind = ts.isObjectLiteralExpression(written)
        ? ("object" as const)
        : ts.isArrayLiteralExpression(written)
          ? ("array" as const)
          : undefined;
      if (kind === undefined) continue;

      found.push({ component, prop: name, kind, ...positionOf(attribute) });
    }

    return found;
  },
} as const satisfies ElementRule<FreshObjectInPropsIssue>;
