import ts from "typescript";
import { positionOf } from "../syntax";
import { openingOf } from "./element";
import { rowCallbackFor } from "./row-callback";
import type { ElementContext, ElementRule, JsxElementLike } from "./rule";

/**
 * `key={i}` — the position, written out as if it were an identity.
 *
 * A key exists to say WHICH row this is, so that the framework can find the same row again after
 * the data changed. The index says where the row was, which is the identity the diff already had
 * without a key at all. So this key changes nothing about how rows are matched, and it is worse
 * than none in one specific way: it silences `row-without-a-key`, and it reads to the next person
 * as a decision somebody made.
 *
 * What that costs is only visible when the list is not append-only. Delete the first of ten rows
 * and every row below it keeps the key it used to have, so the framework matches row 2's DOM to
 * row 1's data — a half-typed input, an open menu, a checked box, all one row off, while the page
 * still looks correct. That is `RMD023` when the framework can see it, which is exactly the case
 * this key hides.
 *
 * ## Why only `.map`
 *
 * `list()` hands its callback ONE argument — there is no index to reach for, deliberately, and the
 * framework derives an identity from the row instead. So this fault can only be written on a
 * `.map` or a `.flatMap`, which is where this rule looks.
 *
 * ## What makes it provable
 *
 * The index is the callback's SECOND parameter, which is a fact about the syntax rather than about
 * any type. A key is reported only when every name it is built from is that parameter:
 * `key={i}`, `key={String(i)}`, `` key={`row-${i}`} ``, `key={i + 1}` are all the index and
 * nothing else, while `` key={`${row.id}-${i}`} `` carries an identity and is left alone.
 */
export interface IndexAsKeyIssue {
  /** The tag or COMPONENT the key was written on, so a report reads like the source. */
  tag: string;
  /** The index parameter's name, which is the reason this key is a position. */
  index: string;
  /**
   * The key AS WRITTEN, because that is what the reader has to find on the line.
   *
   * Not the index name: `` key={`r-${i}`} `` reported as `key={i}` sends somebody looking for
   * something that is not there. Every spelling this rule reports is a different spelling, so the
   * report has to show which one it read.
   */
  written: string;
  file: string;
  line: number;
  column: number;
}

/**
 * Every name an expression is built from, ignoring the right-hand side of a property access.
 *
 * `row.id` is built from `row`; `id` there is a property name and not a reference to anything. That
 * distinction is the whole precision of this rule — without it, `` key={`${row.id}-${i}`} `` would
 * look like it mentions three names and pass, or `key={i}` would look like it mentions one and the
 * two would be told apart by luck.
 */
function namesIn(node: ts.Node, resolve: ElementContext["resolve"], depth = 0): string[] {
  const found: string[] = [];

  const walk = (at: ts.Node): void => {
    if (ts.isPropertyAccessExpression(at)) {
      walk(at.expression);
      return;
    }
    /**
     * `String(i)` mentions `String`, which is a function rather than anything about a row.
     *
     * Only a PLAIN identifier in callee position is skipped. `row.format(i)` is a method on the
     * row, so its result depends on the row and the walk keeps `row` — which is the difference
     * between a key derived from the position and one derived from the data.
     */
    if (ts.isCallExpression(at) && ts.isIdentifier(at.expression)) {
      for (const argument of at.arguments) walk(argument);
      return;
    }
    if (ts.isIdentifier(at)) {
      /**
       * A local the callback built one line up — `const rowKey = \`row-${i}\`; key={rowKey}`.
       *
       * The same key, moved for readability, and it was silent. Only a `const` INSIDE a function:
       * a module-level one cannot mention the index at all, and a `let` can be written again.
       * What comes back is the names the local is built from, so the answer stays a question about
       * the index rather than a guess about a value.
       */
      const declaration = depth < 4 ? localConstBehind(at, resolve) : undefined;
      if (declaration?.initializer !== undefined) {
        found.push(...namesIn(declaration.initializer, resolve, depth + 1));
        return;
      }
      found.push(at.text);
      return;
    }
    ts.forEachChild(at, walk);
  };

  walk(node);
  return found;
}

/** The `const` a name holds, when it is declared inside a function and cannot be written again. */
function localConstBehind(name: ts.Identifier, resolve: ElementContext["resolve"]): ts.VariableDeclaration | undefined {
  const declaration = resolve(name)?.declarations?.[0];
  if (declaration === undefined || !ts.isVariableDeclaration(declaration)) return undefined;

  const list = declaration.parent;
  if (!ts.isVariableDeclarationList(list) || (list.flags & ts.NodeFlags.Const) === 0) return undefined;

  // Inside a function, because that is the only place the index parameter exists.
  for (let at: ts.Node | undefined = declaration.parent; at !== undefined; at = at.parent) {
    if (ts.isArrowFunction(at) || ts.isFunctionExpression(at) || ts.isFunctionDeclaration(at)) return declaration;
    if (ts.isSourceFile(at)) return undefined;
  }
  return undefined;
}

export const indexAsKey = {
  id: "index-as-key",

  report: {
    severity: "warn",
    reportedWhen:
      "a row's `key` is built from the `.map` index and nothing else, which is the identity the diff already had",
    alsoReportedAs: "RMD023",
    heading: (found) => `${found.length} row(s) keyed by their position:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.tag} key={${issue.written}}> is built from \`${issue.index}\` — where the row is, not which row it is.`,
    ],
    advice:
      "The index is the identity the diff already had without any key at all, so this one changes\n" +
      "nothing about how rows are matched — it only silences `row-without-a-key` and reads to the\n" +
      "next person as a decision.\n\n" +
      "What it costs shows the moment the list is not append-only. Delete the first of ten rows and\n" +
      "every row below keeps the key it used to have, so row 2's DOM is matched to row 1's data: a\n" +
      "half-typed input, an open menu, a checked box, all one row off, and the page still looks\n" +
      "right.\n\n" +
      "Use whatever makes the row itself different — an id from the data, or a field combination\n" +
      "that is unique among siblings. If the rows have nothing of the kind, `list()` derives an\n" +
      "identity from the row rather than from its position, which is the whole reason it exists.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(element, { tag, resolve }) {
    /**
     * A COMPONENT row is asked too, and it used to be skipped.
     *
     * `row-without-a-key` already asks one for a key, for the reason that decides both: a component
     * is what HOLDS the state that lands on the wrong row. Answering that question for a `<li>` and
     * not for a `<Row />` left the family disagreeing about the same list, and left this rule
     * silent on the case where the key matters most.
     */
    const named = tag ?? openingOf(element as JsxElementLike).tagName.getText();

    // `row-callback.ts` carries the walk, shared with `row-without-a-key`, and reaches a callback
    // lifted into a `const` — which is where a list long enough to have this fault ends up.
    const index = rowCallbackFor(element as JsxElementLike, resolve)?.index;
    if (index === undefined) return [];

    const written = keyExpressionOf(element as JsxElementLike);
    if (written === undefined) return [];

    // The index and NOTHING else. One name is required, so `key={"row"}` is not a report, and every
    // name has to be the index, so `` key={`${row.id}-${i}`} `` is not one either.
    const names = namesIn(written, resolve);
    if (names.length === 0 || names.some((name) => name !== index)) return [];

    return [{ tag: named, index, written: written.getText(), ...positionOf(openingOf(element as JsxElementLike)) }];
  },
} as const satisfies ElementRule<IndexAsKeyIssue>;

/** The expression inside `key={…}`, or `undefined` when there is no key or it is a plain string. */
function keyExpressionOf(element: JsxElementLike): ts.Expression | undefined {
  for (const attribute of openingOf(element).attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) continue;
    if (attribute.name.getText() !== "key") continue;

    const value = attribute.initializer;
    if (value === undefined || !ts.isJsxExpression(value)) return undefined;
    return value.expression;
  }
  return undefined;
}
