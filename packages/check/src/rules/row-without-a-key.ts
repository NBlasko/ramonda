import ts from "typescript";
import { positionOf } from "../syntax";
import { openingOf } from "./element";
import type { ElementRule, JsxElementLike } from "./rule";

/**
 * A row built from data, with no `key` on it.
 *
 * Two ways to build rows and both are covered, because the argument for writing a key is the same
 * on both sides and the consequence of leaving it out only differs in how quietly it fails.
 *
 * **From `.map()`**, rows have no identity at all without a key: they are matched by POSITION. Add
 * or remove anywhere but the end and every row below it inherits the previous row's state and DOM —
 * a half-typed input, an open menu, a scroll position, all one row off, while the page still looks
 * right. That is `RMD023` at runtime.
 *
 * **From `list()`**, the framework derives an identity from what makes a row different from its
 * siblings, and a hand-written key wins over it — the engine's own words are that yours wins and it
 * only fills in when there is none. So a key here is not redundant; it is the difference between an
 * identity you chose and one that was inferred. The inferred one can fail, which is what `RMD051`
 * exists to say: a row whose every field is nested or shared with its siblings has nothing to be
 * told apart by, and is rebuilt whenever the data is replaced.
 *
 * And the case where inference matters most is the commonest one in an application: data that
 * arrives fresh. A refetch, a `JSON.parse`, a `.map()` over a response — every object is new, so
 * there is no reference to recognise and the key is all there is.
 */
export interface RowWithoutAKeyIssue {
  /** The tag of the row. */
  tag: string;
  /** How the rows are built, because the two need different advice. */
  via: "map" | "list";
  file: string;
  line: number;
  column: number;
}

/** The calls that turn data into rows. `list` is matched by name, as the form rules match `Field`. */
const BUILDS_ROWS = new Set(["map", "list", "flatMap"]);

/**
 * Whether this element IS a row — the value a row-building callback returns.
 *
 * The DIRECT return, and that is the whole precision of this rule: in
 * `rows.map((row) => <tr><td /></tr>)` the `<tr>` is the row and the `<td>` is not, so only the
 * `<tr>` is asked for a key. Walking up through a parenthesis, a conditional and a `&&` keeps that
 * true for the shapes people actually write — `(row) => cond ? <tr /> : <tr className="empty" />`
 * is two rows, not none.
 */
function rowBuiltBy(element: JsxElementLike): "map" | "list" | undefined {
  let at: ts.Node | undefined = element.parent;

  while (at !== undefined) {
    if (ts.isParenthesizedExpression(at) || ts.isConditionalExpression(at) || ts.isBinaryExpression(at)) {
      at = at.parent;
      continue;
    }
    // A `return` inside a block body reaches the same place a concise body does.
    if (ts.isReturnStatement(at) || ts.isBlock(at)) {
      at = at.parent;
      continue;
    }
    if (!ts.isArrowFunction(at) && !ts.isFunctionExpression(at)) return undefined;

    const call = at.parent;
    if (!ts.isCallExpression(call)) return undefined;

    const callee = ts.isPropertyAccessExpression(call.expression)
      ? call.expression.name.text
      : ts.isIdentifier(call.expression)
        ? call.expression.text
        : undefined;

    if (callee === undefined || !BUILDS_ROWS.has(callee)) return undefined;
    return callee === "list" ? "list" : "map";
  }
  return undefined;
}

export const rowWithoutAKey = {
  id: "row-without-a-key",

  report: {
    severity: "warn",
    heading: (found) => `${found.length} row(s) built from data with no \`key\`:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      issue.via === "map"
        ? `    <${issue.tag}> comes from a \`map\`, so without a key these rows are matched by position.`
        : `    <${issue.tag}> comes from a \`list\`, so its identity is inferred rather than chosen.`,
    ],
    advice:
      "Give each row a `key` from your data — an id. Not the array index, which IS the position and\n" +
      "so says nothing a position did not already say.\n\n" +
      "From a `map` there is no identity without it: rows are matched by position, so inserting or\n" +
      "removing anywhere but the end hands every row below it the previous row's state and DOM — a\n" +
      "half-typed input, an open menu, a scroll position, all one row off, while the page still\n" +
      "looks right.\n\n" +
      "From a `list` the framework infers one from what makes a row different from its siblings, and\n" +
      "a key you write wins over it. That inference can fail: a row whose every field is nested or\n" +
      "shared with its siblings has nothing to be told apart by. And the case it matters most in is\n" +
      "the commonest one — data that arrives fresh from a refetch, where every object is new and\n" +
      "there is no reference left to recognise.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(element, { has }) {
    if (has("key")) return [];

    const via = rowBuiltBy(element);
    if (via === undefined) return [];

    /**
     * The tag as WRITTEN, host or component alike — unlike every other rule in this family, which
     * asks about markup and so ignores a component. A row is usually `<Row item={…} />`, and a key
     * on a component is exactly as meaningful as one on a `<tr>`: it is what the diff matches on,
     * and the component is what holds the state that goes to the wrong row without it.
     */
    const tag = openingOf(element).tagName.getText();
    return [{ tag, via, ...positionOf(openingOf(element)) }];
  },
} as const satisfies ElementRule<RowWithoutAKeyIssue>;
