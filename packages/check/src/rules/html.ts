import ts from "typescript";
import type { JsxElementLike } from "./rule";
import { tagOf } from "./element";

/**
 * What the HTML content model says about which tag goes inside which.
 *
 * Source: the HTML Living Standard's content models. Only the rules where the parent is a CLOSED
 * set — a `<tr>` has exactly four places it may be, and there is no arguing about it. The looser
 * parts of the content model are left out on purpose: "flow content" and "phrasing content" admit
 * so much that a rule over them would spend its life reporting correct markup.
 *
 * **An ANCESTOR requirement is not a parent requirement**, which is why `<area>` is absent: it needs
 * a `<map>` above it somewhere, and `<map><p><area /></p></map>` is legal. This table is read
 * against the DIRECT parent, so an entry for it would report correct markup.
 */
export const NEEDS_PARENT: Readonly<Record<string, readonly string[]>> = {
  tr: ["table", "thead", "tbody", "tfoot"],
  td: ["tr"],
  th: ["tr"],
  thead: ["table"],
  tbody: ["table"],
  tfoot: ["table"],
  caption: ["table"],
  colgroup: ["table"],
  col: ["colgroup"],
  option: ["select", "optgroup", "datalist"],
  optgroup: ["select"],
  summary: ["details"],
  legend: ["fieldset"],
  figcaption: ["figure"],
  // `<dl>` may wrap its pairs in a `<div>`, which the spec allows explicitly, so a `div` counts.
  dt: ["dl", "div"],
  dd: ["dl", "div"],
  li: ["ul", "ol", "menu"],
  source: ["audio", "video", "picture"],
  track: ["audio", "video"],
  // Ruby annotation. Both go directly inside `<ruby>` and nowhere else — `<rtc>` was the other
  // answer and has been removed from the standard, so the set really is closed.
  rt: ["ruby"],
  rp: ["ruby"],
};

/**
 * Tags that may not contain another of their own kind, and why each is its own fault.
 *
 * A nested one is not a smaller version of the outer: the HTML parser closes the first when it
 * meets the second, so the markup that reaches the page is not the markup that was written. What
 * follows is a click that goes to the wrong place, or a form that submits half of itself.
 */
export const NOT_INSIDE_ITSELF: ReadonlySet<string> = new Set(["a", "button", "form", "label"]);

/**
 * The nearest enclosing JSX element, or `undefined` when this cannot be sure there is one.
 *
 * ## What it walks through, and why each one
 *
 * An expression, a fragment, a conditional and a `&&` all render their contents WHERE THEY SIT, so
 * the tag above them is still the parent: `<table>{ready && <tr />}</table>` puts the row in the
 * table exactly as writing it plainly would.
 *
 * A CALLBACK is walked through too, and that is the one judgement call here. `<tbody>{rows.map(
 * (row) => <tr key={row.id} />)}</tbody>` is how every table in every application is written, and a
 * version of this rule that stopped at the arrow would be silent about tables — which is most of
 * what it exists for. The analyzer already believes this about callbacks elsewhere: `list(each,
 * (item) => <Row />)` is recorded as rendering where the list sits. The cost is a callback that
 * hands its element somewhere else to be mounted, and inside a table that is not a shape anyone
 * writes.
 *
 * ## Where it gives up
 *
 * A function DECLARATION, a class, or the top of the file. At that point the element is a return
 * value and where it lands is decided by whoever calls it — which this cannot see, so it says
 * nothing rather than guess.
 */
export function enclosingElement(element: JsxElementLike): JsxElementLike | undefined {
  let at: ts.Node | undefined = element.parent;

  while (at !== undefined) {
    if (ts.isJsxElement(at) || ts.isJsxSelfClosingElement(at)) return at;

    const transparent =
      ts.isJsxExpression(at) ||
      ts.isJsxFragment(at) ||
      ts.isParenthesizedExpression(at) ||
      ts.isConditionalExpression(at) ||
      ts.isBinaryExpression(at) ||
      ts.isArrowFunction(at) ||
      ts.isCallExpression(at) ||
      ts.isArrayLiteralExpression(at);

    if (!transparent) return undefined;
    at = at.parent;
  }
  return undefined;
}

/** The nearest enclosing HOST tag, `undefined` when there is none or a component is in the way. */
export function enclosingTag(element: JsxElementLike): string | undefined {
  const enclosing = enclosingElement(element);
  return enclosing === undefined ? undefined : tagOf(enclosing);
}
