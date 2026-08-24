import { positionOf } from "../syntax";
import { descendantIn } from "./descendants";
import { openingOf } from "./element";
import type { ElementContext, ElementRule } from "./rule";

/**
 * A `<label>` with nothing to be a label FOR.
 *
 * A label is not a piece of styled text — it is an association, and HTML gives it exactly two ways
 * to make one: `htmlFor` naming a control's id, or a control written inside it. With neither, the
 * element renders, looks completely right, and does nothing at all.
 *
 * Two things are lost, and the second is the one people do not expect. The control it was meant for
 * has no accessible name, so a screen reader announces "edit, blank" and stops — which is
 * `control-with-no-label`'s report at the other end of the same missing pair. And **clicking the
 * text no longer focuses the field**, which is the affordance everybody uses without thinking about
 * it, and which is hardest on the people with the least room to absorb it: a large click target is
 * the difference between a usable form and an unusable one for somebody with a tremor.
 *
 * This is the LABEL's end of the pair, and it is worth having separately because the two ends are
 * written in different files by different people. A form component owns the control; a design
 * system owns the label.
 *
 * ## What it will not claim
 *
 * **A control this cannot see is a control.** `<label>Name<TextField /></label>` is the ordinary way
 * a form is written, and what `<TextField />` renders is decided inside it. So is anything in an
 * expression — `<label>Name{editing && <input />}</label>`. Both go quiet, which is the silence
 * contract: the cost of being wrong here is telling somebody their working form is broken.
 *
 * **An `htmlFor` written at all**, readable or not. Whether it points at a real id is a different
 * question and `reference-to-an-id-that-is-not-there` already answers it; two reports on one line is
 * how a reader learns to skim past both.
 *
 * **An element that spreads**, because the spread may be carrying the `htmlFor`.
 */
export interface LabelThatNamesNothingIssue {
  file: string;
  line: number;
  column: number;
}

/** The controls a `<label>` may wrap. `output` and `progress` are labelable too. */
const LABELABLE: ReadonlySet<string> = new Set([
  "button",
  "input",
  "meter",
  "output",
  "progress",
  "select",
  "textarea",
]);

export const labelThatNamesNothing = {
  id: "label-that-names-nothing",

  report: {
    severity: "warn",
    reportedWhen: "a `<label>` has no `htmlFor` and no control inside it, so it labels nothing",
    heading: (found) => `${found.length} \`<label>\` with nothing to label:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      "    <label> has no `htmlFor` and no control inside it — it names nothing, and clicking it focuses nothing.",
    ],
    advice:
      "A label is an association, not styled text, and HTML gives it two ways to make one:\n" +
      "`htmlFor` naming a control's id, or the control written inside it.\n\n" +
      "```tsx\n" +
      '<label htmlFor="email">Email</label>\n' +
      '<input id="email" type="email" />\n' +
      "```\n\n" +
      "or, with no id to keep in step:\n\n" +
      "```tsx\n" +
      '<label>Email <input type="email" /></label>\n' +
      "```\n\n" +
      "With neither, two things are lost. The control has no accessible name, so a screen reader\n" +
      'announces "edit, blank" and stops. And clicking the text no longer focuses the field — the\n' +
      "affordance everybody uses without thinking about it, and the one that makes a form usable\n" +
      "for somebody with a tremor.\n\n" +
      "If the text really is not a caption for anything, it is not a label: use a `<span>`, or a\n" +
      "`<legend>` if it heads a `<fieldset>`.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(element, { tag, has, spreads, children }: ElementContext) {
    if (tag !== "label") return [];
    // Written at all, readable or not. Whether it points at a real id is another rule's question.
    if (has("htmlFor") || has("for")) return [];
    // A spread may be carrying the `htmlFor`.
    if (spreads) return [];
    // A control this cannot SEE is a control — a component, or anything in an expression.
    if (descendantIn(children, (_opening, inside) => LABELABLE.has(inside)) !== "none") return [];

    return [positionOf(openingOf(element))];
  },
} as const satisfies ElementRule<LabelThatNamesNothingIssue>;
