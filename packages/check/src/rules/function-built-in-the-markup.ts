import ts from "typescript";
import { positionOf } from "../syntax";
import { openingOf } from "./element";
import { eventTypeOf } from "./events";
import { builtFunctionIn, shorten } from "./follow-value";
import { stablePropsOf } from "./fresh-object-in-props";
import type { ElementContext, ElementRule } from "./rule";

/**
 * A function literal written straight into a JSX attribute.
 *
 * An arrow written in the markup is BUILT during the render, so what the attribute carries is a
 * different function every time — identical source, fresh identity. On a host element the diff sees
 * a changed listener and takes the old one off and puts the new one on, every render. On a
 * component it is a prop that can never compare equal, so the child renders again whenever its
 * parent does.
 *
 * ## The static half of a runtime check
 *
 * `RMD020` already reports this, as its `handler` verdict: a development build renders every
 * component twice in one tick and compares, and a function built in place shows the same source
 * with a fresh identity. Its words are the ones this rule mirrors — *"an event handler whose
 * identity changed is removed and re-added on the element every render (and a component prop that
 * is a function makes the child re-render)"*.
 *
 * The boundaries are mirrored too, rather than invented: a prop the child declared with
 * `@StableProps` is skipped exactly as the runtime skips it, and the fix is the runtime's fix — a
 * bound method, or `@memoized` when the handler has to be built per item.
 *
 * ## Measured, not reasoned about
 *
 * `<button onclick={() => this.n} />` under a component whose state changes, counting the calls the
 * diff makes on the element itself: over three re-renders, **3 `addEventListener` and 3
 * `removeEventListener`** — one pair per render, which is the churn the runtime's message names.
 *
 * And the two were checked against each other rather than assumed to agree. With `strictRender` on,
 * `<AsyncLoad lazy={() => import(…)} errorFallback={({ retry }) => …} />` makes `RMD020` name
 * `AsyncLoad.lazy` and `AsyncLoad.errorFallback` — the same two props, at the same sites, this rule
 * reports. A checker stricter than the runtime it mirrors would be reporting its own opinion.
 *
 * What a static rule adds is the moment. `RMD020` needs a development build, the component to
 * actually render, and the branch holding the fault to be the one that ran. This reads the source,
 * so a handler on a page nobody opened is reported the same as one on the home page.
 *
 * ## Why it fires on a host element, where `fresh-object-in-props` does not
 *
 * Its sibling asks whether a CHILD can skip a render, so a host element — which hands nothing to a
 * component — has nothing to defeat and is left alone. This question is different: a listener is
 * attached to a real DOM node, and its identity changing is what makes the diff remove and re-add
 * it. `<button onclick={() => …}>` is the commonest spelling of this fault and the one the runtime
 * names first, so a rule silent on host elements would be silent on almost all of it.
 *
 * ## What is deliberately NOT reported
 *
 * **A CALL, wherever it leads.** `onclick={this.pickRow(row)}` is the recommended answer, not the
 * fault: `@memoized` caches by its arguments, per instance, so asking twice hands back the same
 * function. `onclick={debounce(this.save, 200)}` is the same shape and has nowhere else to live.
 * Following a call would find the arrow inside and report the fix — which is the trap
 * `arrow-fields` is pinned against, one level in.
 *
 * **A method, a field, a property read, a prop.** `onclick={this.save}` is the answer this reports
 * in favour of. `onclick={this.fieldArrow}` is one identity per INSTANCE rather than per render, so
 * it is stable across renders and belongs to `arrow-fields`, which reports the field itself.
 * `onclick={this.handlers.save}` and `onclick={this.props.onPick}` are not knowable from here.
 *
 * **A module-level `const`**, which is built once when the module loads and is the documented fix —
 * in this file or an imported one.
 *
 * **`key` and `ref`**, which the framework consumes itself rather than handing on.
 *
 * **A prop the component DECLARED with `@StableProps`.** The framework then compares by content and
 * hands the child back the identity it already had, so reporting it would be reporting the fix. The
 * declaration is resolved through the checker and read along the class chain, because `@StableProps`
 * merges that way.
 *
 * **An attribute a SPREAD may overwrite.** `<button onclick={() => …} {...rest} />` builds the
 * function, but whether it ever reaches the element depends on what `rest` holds — and a listener
 * that is never attached is not churn, however wastefully it was built.
 *
 * That was written down the other way round first, on the reading that what the AUTHOR wrote stands
 * whichever side of a spread it is on — which is true of a misspelling and not of this. Measured,
 * both halves: `<button onclick={written} {...{ onclick: fromSpread }} />` clicked runs ONLY the
 * spread's handler, and `{...{ onclick: undefined }}` after it runs NEITHER. So the written arrow
 * really can fail to reach the element, and reporting it would name churn that does not happen.
 *
 * Written AFTER the last spread nothing can take it away, and it is reported. This is the same
 * asymmetry `fresh-object-in-props` records: a spread may supply an attribute that is MISSING, but
 * it cannot un-build one that is plainly there.
 *
 * ## Why a warning
 *
 * The page is right either way. The listener is removed and re-added and the handler still runs;
 * the child renders again and produces the same output. What it costs is work, and inside a `list`
 * it multiplies by the number of rows.
 */
export interface FunctionBuiltInTheMarkupIssue {
  /** The tag as written — a host element's name, or the component's. */
  owner: string;
  /** Whether the value goes to a real DOM node or into a component's props, which changes the cost. */
  on: "element" | "component";
  /** The attribute's name, as written, both spellings included. */
  attribute: string;
  /** The DOM event this listens for — a HOST element's listener only, never a component's prop. */
  event: string | undefined;
  /**
   * How it is written at the call site, so the report quotes the line rather than a shape.
   *
   * `onclick={local}` and `onclick={() => …}` are the same fault, and printing the second for the
   * first sends a reader looking for an arrow that is not on the line.
   */
  written: string;
  /** Where the function is built, when that is not this line — the local it came from. */
  builtIn: string | undefined;
  /** Whether this is rendered once per ITEM, which is the same fault at the scale that hurts. */
  perRow: boolean;
  file: string;
  line: number;
  column: number;
}

/** Calls whose callback runs once per item, so anything built inside it is built per item. */
const PER_ITEM: ReadonlySet<string> = new Set(["map", "flatMap", "list"]);

/** Attributes the framework consumes itself, so nothing is attached and nothing is handed on. */
const NOT_PASSED_ON: ReadonlySet<string> = new Set(["key", "ref"]);

/**
 * Whether this sits inside a callback that runs once per item.
 *
 * Read for the REPORT rather than for the finding: the fault is the same either way, but a handler
 * that closes over the row cannot be lifted out of the render, so the advice that fits a single
 * element is the wrong advice here.
 */
function insideAList(node: ts.Node): boolean {
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    const here = at;
    if ((ts.isArrowFunction(here) || ts.isFunctionExpression(here)) && ts.isCallExpression(here.parent)) {
      const callee = here.parent.expression;
      const named = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : "";
      if (PER_ITEM.has(named) && here.parent.arguments.some((argument) => argument === here)) return true;
    }
    // A method body is as far as this needs to look: a callback is written inside the render.
    if (ts.isMethodDeclaration(here) || ts.isSourceFile(here)) return false;
  }
  return false;
}

/**
 * What the fresh identity actually costs here, which is not the same sentence at all four sites.
 *
 * "Lift it to a constant" is wrong for a per-row handler and "the listener is re-added" is wrong
 * for a component, so the report says which of the four this is rather than one sentence that fits
 * none of them.
 */
function consequence(issue: FunctionBuiltInTheMarkupIssue): string {
  if (issue.on === "component") {
    return issue.perRow
      ? `no <${issue.owner}> can be skipped when the list renders again.`
      : `<${issue.owner}> re-renders whenever its parent does.`;
  }
  // A function in a non-event attribute on a host element: there is no listener to churn, and what
  // is left is the write itself.
  if (issue.event === undefined) return `\`${issue.attribute}\` is written to the element again every render.`;
  return issue.perRow
    ? `the ${issue.event} listener on every row is removed and re-added when the list renders again.`
    : `the ${issue.event} listener is removed and re-added on every render.`;
}

export const functionBuiltInTheMarkup = {
  id: "function-built-in-the-markup",

  report: {
    severity: "warn",
    reportedWhen:
      "a function literal is written into a JSX attribute — in the attribute, on one side of a ternary or a `??`, or in a local one line up — so its identity is fresh every render, and the listener is removed and re-added or the child can never compare its prop equal",
    alsoReportedAs: "RMD020",
    heading: (found) => `${found.length} function(s) built in the markup:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.owner} ${issue.attribute}={${issue.written}}> is a new function ${
        issue.perRow ? "for every row" : "every render"
      }${issue.builtIn === undefined ? "" : `, built in ${issue.builtIn}`}, so ${consequence(issue)}`,
    ],
    advice:
      "A function written in the markup is built during the render, so the source is the same and\n" +
      "only the identity is fresh. On an element the diff sees a changed listener and takes the old\n" +
      "one off and puts the new one on, every render. On a component it is a prop that can never\n" +
      "compare equal, so the child renders again whenever its parent does.\n\n" +
      "Moving it does not fix it. A `const` at the top of `render()`, an arm of a ternary and a\n" +
      "fallback behind `??` are the same function built at the same moment, and all of them are\n" +
      "reported.\n\n" +
      "Give it a stable identity instead. A bound method is the answer for almost every case —\n" +
      "`onclick={this.save}` — because Ramonda binds your methods to the instance when the component\n" +
      "is built, so there is no constructor and no arrow-field to write.\n\n" +
      "PER ROW, that is not open to you, because the handler has to know which row it is. `@memoized`\n" +
      "is the one that works: it caches by its arguments, per instance, so asking twice hands back the\n" +
      "same function. The decorated method RETURNS the handler rather than being one.\n\n" +
      "A CALL is never reported, which is why both of those are silent — and neither is a field\n" +
      "holding an arrow, which is one identity per instance rather than per render. `arrow-fields`\n" +
      "reports that one, where it is written.\n\n" +
      "The page is correct either way, which is why this is a warning: what it costs is work, not\n" +
      "output. `RMD020` reports the same fault at runtime, in a development build.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  evenWhenSpreading: true,

  read(element, { tag, resolve }) {
    const opening = openingOf(element);
    const owner = opening.tagName.getText();
    // `tag` is set exactly when this names a host element, and `undefined` when it names a
    // component — which is also the only case with props to declare stable.
    const settled = tag === undefined ? stablePropsOf(opening.tagName, resolve) : new Set<string>();
    const attributes = opening.attributes.properties;
    const found: FunctionBuiltInTheMarkupIssue[] = [];

    /**
     * Everything up to and including the last spread is left alone.
     *
     * JSX applies attributes in written order, so a spread AFTER one may overwrite it — and a
     * listener that never reaches the element cannot be removed and re-added. Written after the
     * last spread nothing can take it away, and the fault is provable in spite of the spread.
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

      const built = builtFunctionIn(value.expression, resolve, 0);
      if (built === undefined) continue;

      found.push({
        owner,
        on: tag === undefined ? "component" : "element",
        attribute: name,
        // Only a HOST element has a DOM event to name. `<Row onPick={…} />` is a prop that happens
        // to start with `on`, and calling it a `pick` listener would be inventing one.
        event: tag === undefined ? undefined : eventTypeOf(name)?.type,
        written: shorten(value.expression),
        builtIn: built.foundIn,
        perRow: insideAList(attribute),
        ...positionOf(attribute),
      });
    }

    return found;
  },
} as const satisfies ElementRule<FunctionBuiltInTheMarkupIssue>;
