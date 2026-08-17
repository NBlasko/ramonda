import ts from "typescript";
import { positionOf } from "../syntax";
import { openingOf } from "./element";
import type { ElementRule, JsxElementLike } from "./rule";

/**
 * A `tabIndex` above zero, which moves the element to the front of the tab order.
 *
 * There are three answers and only two of them are local. `tabIndex={0}` puts an element in the tab
 * order where it sits. `tabIndex={-1}` takes it out while leaving it focusable by script. A POSITIVE
 * one does something else entirely: it creates a second tab order that runs before every `0` on the
 * page, so one number written in one component reorders the whole document.
 *
 * That is why it is a fault rather than a preference. The element that jumps the queue is usually
 * fine; what breaks is everything else, in a file nobody edited, and the person who finds it is
 * tabbing through a form and landing somewhere impossible.
 */
export interface PositiveTabIndexIssue {
  /** The tag it was written on, so a report reads like the source. */
  tag: string;
  /** The value, which is the whole point of the report. */
  value: number;
  file: string;
  line: number;
  column: number;
}

export const positiveTabIndex = {
  id: "positive-tabindex",

  report: {
    severity: "warn",
    heading: (found) => `${found.length} element(s) with a positive \`tabIndex\`:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.tag} tabIndex={${issue.value}}> jumps ahead of every element with \`0\`.`,
    ],
    advice:
      "A positive `tabIndex` does not move one element — it creates a second tab order that runs\n" +
      "before the whole document's. One number in one component reorders every page it appears on,\n" +
      "and what breaks is the file nobody edited.\n\n" +
      "`tabIndex={0}` puts an element in the tab order where it sits, which is almost always what\n" +
      "was meant. `tabIndex={-1}` takes it out while leaving it focusable from script, for a thing\n" +
      "you focus yourself. To change the ORDER, change the order of the markup.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(element, { tag, attr }) {
    if (tag === undefined) return [];

    /**
     * Read as a literal only, which is the silence contract doing its job.
     *
     * `tabIndex={index}` inside a list may well be positive, and this cannot know — so it says
     * nothing. `attr` already answers `undefined` for anything it cannot read; a number written in
     * braces is the one form it returns as text, so it is parsed here rather than trusted.
     */
    const written = attr("tabIndex") ?? numberInBraces(element);
    if (written === undefined) return [];

    const value = Number(written);
    if (!Number.isInteger(value) || value <= 0) return [];

    return [{ tag, value, ...positionOf(openingOf(element)) }];
  },
} as const satisfies ElementRule<PositiveTabIndexIssue>;

/**
 * `tabIndex={1}` — a numeric literal in braces, which is how JSX writes a number.
 *
 * `attr` deliberately answers only for strings, because for every other rule in this family a
 * number is not the kind of value being asked about. Here it is the only kind, so it is read here
 * rather than by widening what every other rule has to think about.
 */
function numberInBraces(element: JsxElementLike): string | undefined {
  for (const attribute of openingOf(element).attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) continue;
    if (attribute.name.getText().toLowerCase() !== "tabindex") continue;

    const value = attribute.initializer;
    if (value === undefined || !ts.isJsxExpression(value) || value.expression === undefined) return undefined;

    // `{1}` is a literal; `{-1}` is a prefix expression and never positive, so it is left unread.
    return ts.isNumericLiteral(value.expression) ? value.expression.text : undefined;
  }
  return undefined;
}
