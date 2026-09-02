import ts from "typescript";
import { coreDecoratorName } from "./core-import";
import { positionOf } from "../syntax";
import { NOT_PASSED_ON, insideAList, openingOf } from "./element";
import { freshnessOf, shorten } from "./follow-value";
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
 * ## Inside a list
 *
 * `{rows.map((row) => <Row conf={{ id: row.id }} />)}` is the same fault at the scale that hurts:
 * the literal is built once per ROW, so no row can be skipped. It is reported in those words,
 * because the fix is not the one that fits a single element — a value derived from the row cannot
 * be lifted to a constant. The row itself, `conf={row}`, is as stable as the array holding it and
 * is never reported.
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
 * **Children, and a JSX element handed over as a prop.** Both are rebuilt every render and both
 * really do defeat comparison — measured in `ChildrenAreProps.test.tsx`: a `<Panel>text</Panel>`
 * renders four times over three renders of its parent, where a component given no children renders
 * once. It is not reported because it is not a mistake anyone made on that line: EVERY composed
 * element on the page is this, and a rule that reported them would report the whole app. The fix is
 * a decision about the component rather than about the call site — `@StableProps` names `children`
 * like any other prop, and a slot declared as a component CLASS is already stable, because a class
 * is the same reference forever.
 *
 * The literal INSIDE either one is still reported. `header={<Row conf={{ dense: true }} />}` is
 * walked as its own element, and the `conf` on it is a choice like any other.
 *
 * **A module-level `const`**, which is built once and is the documented fix — and **a helper that
 * hands back an object it holds**, which is the same fix behind a function call. The distinction
 * both times is where the literal is BUILT, not where it is written.
 *
 * **A `@compute` or a `@memoized` call**, because caching is the whole of what those do. The second
 * was missing and the DOCUMENTATION found it: `concepts/caching.md` teaches
 * `cfg={this.configFor(row.id)}` as the answer to this very report, and running the rules over the
 * docs' own examples reported the page teaching the fix. It is the per-ROW answer specifically —
 * a `@compute` belongs to the component and cannot hold one value per row.
 *
 * **An attribute a SPREAD may overwrite.** `<Row conf={{…}} {...rest} />` builds the object, but
 * whether the child ever sees it depends on what `rest` holds, and a prop that never arrives is not
 * this fault. Written AFTER the last spread it cannot be taken away, and it is reported — which is
 * why this is the one element rule that is still asked about a spreading element: a spread may
 * supply an attribute that is missing, but it cannot un-build one that is plainly there.
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
  /**
   * Whether the element is rendered once per ITEM, inside a `map` or a `list` callback.
   *
   * The same fault, but not the same advice: a per-row value cannot be lifted to a constant,
   * because it depends on the row. It is also the case that costs the most — one literal in a
   * callback is one child per item that can never be skipped.
   */
  perRow: boolean;
  file: string;
  line: number;
  column: number;
}

/**
 * The names `createContext` was given in `stableProps`, when this binding is a Provider it made.
 *
 * A context Provider is not a class an app WROTE — `createContext` returns it, and the app
 * destructures it — so there is no declaration to carry a decorator and the walk below finds
 * nothing. The declaration is at the call instead:
 *
 *     const [ConfProvider, ConfConsumer] = createContext(defaults, { stableProps: ["conf"] });
 *
 * Only the FIRST element is asked. The second is the Consumer, which takes no props callback at
 * all, so reading a declaration off it could only ever answer a question nobody asks.
 *
 * `createContext` is identified through core rather than by the name at the call, for the reason
 * every other read here is: an alias is a different binding with the same letters, and a rule that
 * matches letters reports the fix it recommends.
 */
function stablePropsFromCreateContext(binding: ts.Declaration, resolve: ElementContext["resolve"]): string[] {
  if (!ts.isBindingElement(binding)) return [];

  const pattern = binding.parent;
  if (!ts.isArrayBindingPattern(pattern)) return [];
  if (pattern.elements.indexOf(binding) !== 0) return [];

  const declaration = pattern.parent;
  if (!ts.isVariableDeclaration(declaration)) return [];

  const call = declaration.initializer;
  if (call === undefined || !ts.isCallExpression(call)) return [];
  if (resolve.coreName(call.expression) !== "createContext") return [];

  const options = call.arguments[1];
  if (options === undefined || !ts.isObjectLiteralExpression(options)) return [];

  const declared = options.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === "stableProps",
  );
  if (declared === undefined || !ts.isArrayLiteralExpression(declared.initializer)) return [];

  return declared.initializer.elements
    .filter(
      (one): one is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
        ts.isStringLiteral(one) || ts.isNoSubstitutionTemplateLiteral(one),
    )
    .map((one) => one.text);
}

/**
 * The prop names a component declared as values, its bases included.
 *
 * Two spellings, one answer. A class says it with `@StableProps`; a context Provider says it in the
 * `createContext` call that made it, because there is no class of the app's own to decorate. Both
 * are read here so a caller asks one question.
 *
 * Resolved rather than matched by name — a class whose name happens to equal this one's is a
 * different class — and the chain is walked because `@StableProps` merges along it: a base that
 * declares `filter` settles it for every subclass, which is the behaviour the decorator promises.
 *
 * Bounded at four hops and cycle-guarded, the same as everywhere else this package follows a
 * heritage chain.
 */
export function stablePropsOf(tagName: ts.Node, resolve: ElementContext["resolve"]): ReadonlySet<string> {
  const found = new Set<string>();
  const seen = new Set<ts.Node>();

  const declarations = resolve(tagName)?.declarations ?? [];
  for (const one of declarations) {
    for (const name of stablePropsFromCreateContext(one, resolve)) found.add(name);
  }

  let declaration = declarations.find((one): one is ts.ClassDeclaration => ts.isClassDeclaration(one));

  for (let hop = 0; hop < 4 && declaration !== undefined && !seen.has(declaration); hop++) {
    seen.add(declaration);

    for (const decorator of ts.getDecorators(declaration) ?? []) {
      // Core's `@StableProps`, by the name core exports — an alias hid the declaration and made
      // this report the very prop the child had declared stable.
      if (coreDecoratorName(decorator, resolve) !== "StableProps") continue;
      const call = decorator.expression;
      if (!ts.isCallExpression(call)) continue;
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
      "a component is handed an object or array built during the render, so it is a new value every " +
      "time and comparison can never match — lift it to a field or a `@compute`, or declare it on the " +
      "child with `@StableProps`",
    heading: (found) => `${found.length} prop(s) rebuilt on every render:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component} ${issue.prop}={${issue.written}}> is a new ${issue.kind} ${
        issue.perRow ? "for every row" : "every render"
      }${issue.builtIn === undefined ? "" : `, built in ${issue.builtIn}`}, so ${
        issue.perRow
          ? `no <${issue.component}> can be skipped when the list renders again.`
          : `<${issue.component}> re-renders whenever its parent does.`
      }`,
    ],
    advice:
      "A literal written in JSX is built during the render, so the child is handed a different\n" +
      "object every time — never equal to the one before it, however identical its contents.\n" +
      "Comparison cannot match, and the child renders again whenever its parent does, whether or\n" +
      "not anything about it changed. Measured: one child goes from one render to two; a list of a\n" +
      "thousand rows is a thousand children that cannot be skipped.\n\n" +
      "Moving the literal does not fix it. A `const` at the top of `render()`, an arm of a ternary,\n" +
      "a fallback behind `??`, and a helper that returns a literal — however many helpers deep — are\n" +
      "all the same object built at the same moment, and all of them are reported.\n\n" +
      "Inside a `map` or a `list` this is the same fault at the worst scale — one literal in the\n" +
      "callback is one child per row that can never be skipped — and lifting it out is not open to\n" +
      "you, because the value depends on the row. Two things do work: declare the prop on the ROW\n" +
      "component with `@StableProps`, or build the values once in a `@compute` that maps the array\n" +
      "and hand each row the one that belongs to it.\n\n" +
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

  evenWhenSpreading: true,

  read(element, { tag, resolve }) {
    // A host element has no props to compare. `tag` is `undefined` exactly when this names a
    // component, which is the only case with a comparison to defeat.
    if (tag !== undefined) return [];

    const opening = openingOf(element);
    const component = opening.tagName.getText();
    const settled = stablePropsOf(opening.tagName, resolve);
    const attributes = opening.attributes.properties;
    const found: FreshObjectInPropsIssue[] = [];

    /**
     * Everything up to and including the last spread is left alone.
     *
     * JSX applies attributes in written order, so a spread AFTER one may overwrite it — and a prop
     * that never reaches the child is not this fault, however wastefully it is built. Written after
     * the last spread, nothing can take it away, and the fault is provable in spite of the spread.
     */
    const lastSpread = attributes.reduce(
      (at, attribute, index) => (ts.isJsxSpreadAttribute(attribute) ? index : at),
      -1,
    );

    for (const [index, attribute] of attributes.entries()) {
      if (index < lastSpread) continue;
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
        perRow: insideAList(attribute),
        ...positionOf(attribute),
      });
    }

    return found;
  },
} as const satisfies ElementRule<FreshObjectInPropsIssue>;
