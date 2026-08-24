import { positionOf } from "../syntax";
import { numberAttr, openingOf } from "./element";
import type { ElementRule } from "./rule";

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
    reportedWhen: "a `tabIndex` is above zero, which reorders the whole document rather than one element",
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

  /**
   * Reported past a spread, from the side a spread cannot reach over.
   *
   * A rule about what the element WILL BE, so it takes the order guard itself:
   * `<div {...rest} tabIndex={5} />` is in the tab order at 5 whatever `rest` holds, and
   * `<div tabIndex={5} {...rest} />` may end up with any tabIndex at all — or none, since a later
   * `undefined` removes the attribute outright, measured through `renderToString`.
   */
  evenWhenSpreading: true,

  read(element, { tag, resolve, overwritable }) {
    if (tag === undefined) return [];
    if (overwritable("tabIndex")) return [];

    /**
     * Read as a literal only, which is the silence contract doing its job.
     *
     * `tabIndex={index}` inside a list may well be positive, and this cannot know — so it says
     * nothing. `numberAttr` answers `undefined` for anything that is not written out, and it is
     * shared with `aria-hidden-on-focusable` so the two rules cannot disagree about what a
     * `tabIndex` says on the same line.
     */
    const value = numberAttr(element, "tabIndex", resolve);
    if (value === undefined || value <= 0) return [];

    return [{ tag, value, ...positionOf(openingOf(element)) }];
  },
} as const satisfies ElementRule<PositiveTabIndexIssue>;
