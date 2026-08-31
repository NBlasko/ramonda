import { positionOf } from "../syntax";
import type { ElementContext, ElementRule } from "./rule";

/**
 * An `aria-*` written `"false"` beside the HTML attribute that says the opposite.
 *
 * `<input required aria-required="false">`, `<button disabled aria-disabled="false">`. The HTML
 * attribute is doing its job — the form will refuse to submit, the button will not take a click —
 * and the ARIA one **overrides what a screen reader is told about it**. So the reader is informed
 * the field is optional and then cannot submit, or that the button is available and then nothing
 * happens when they press it.
 *
 * It is worse than either half missing. A control with nothing said about it leaves a reader to find
 * out by trying; a control that says the opposite of what it does sends them looking for a fault
 * somewhere else on the page. Somebody who is told a required field is optional does not go back to
 * it — they go hunting through the rest of the form.
 *
 * ## Where it comes from, which is why it is worth reporting rather than assuming nobody writes it
 *
 * Nobody sets out to contradict themselves. It arrives when ARIA is added "to be safe" beside markup
 * that already said the same thing, and the value gets bound to the wrong side of a condition — or
 * when `required` is added later to a field whose `aria-required="false"` nobody re-read. Both leave
 * a page that works perfectly for anybody using a mouse.
 *
 * ## Only the contradiction, and only when the source settles both halves
 *
 * The pairs here are the ones where the HTML attribute is a plain boolean and its ARIA counterpart
 * is a boolean token — the two say ONE thing, and it is written twice. `aria-required="true"` beside
 * `required` is redundant and is not reported: saying a thing twice is untidy, and this package
 * reports faults rather than untidiness.
 *
 * Anything unreadable on either side is left alone. `disabled={busy} aria-disabled={busy}` is the
 * correct way to write the pair when it moves, and the two are the same expression — a rule that
 * guessed at either would report exactly that.
 */
export interface AriaThatContradictsTheTagIssue {
  /** The element it was written on. */
  tag: string;
  /** The HTML attribute, as written. */
  html: string;
  /** The ARIA attribute that contradicts it. */
  aria: string;
  file: string;
  line: number;
  column: number;
}

/**
 * HTML boolean attribute → the `aria-*` that says the same thing.
 *
 * From the HTML accessibility mappings: each of these attributes sets its ARIA counterpart
 * implicitly, and an explicit one written beside it replaces what assistive technology is told.
 */
const SAYS_THE_SAME: ReadonlyMap<string, string> = new Map([
  ["required", "aria-required"],
  ["disabled", "aria-disabled"],
  ["checked", "aria-checked"],
  ["readonly", "aria-readonly"],
  ["hidden", "aria-hidden"],
  ["open", "aria-expanded"],
]);

export const ariaThatContradictsTheTag = {
  id: "aria-that-contradicts-the-tag",

  report: {
    severity: "warn",
    reportedWhen: "an `aria-*` is written `false` beside the HTML attribute that says the opposite",
    heading: (found) => `${found.length} element(s) telling a screen reader the opposite of what they do:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.tag} ${issue.html}> carries \`${issue.aria}="false"\` — the element ${issue.html === "hidden" ? "is" : "does"} one thing and says the other.`,
    ],
    advice:
      "The HTML attribute is doing its job: the form will refuse to submit, the button will not take\n" +
      "a click. The `aria-*` beside it overrides what a screen reader is TOLD about that — so the\n" +
      "reader hears that the field is optional and then cannot submit, or that the button is\n" +
      "available and then nothing happens when they press it.\n\n" +
      "That is worse than saying nothing at all. A control with nothing said about it leaves a\n" +
      "reader to find out by trying; one that says the opposite of what it does sends them looking\n" +
      "for a fault somewhere else on the page.\n\n" +
      "Delete the `aria-*`. The HTML attribute already sets it — `required` means `aria-required`,\n" +
      "`disabled` means `aria-disabled`, and writing either again can only disagree with it.\n\n" +
      "Where the state really does move, bind BOTH to the same expression, or bind neither and let\n" +
      "the HTML attribute alone carry it:\n\n" +
      "```tsx\n" +
      '<button type="button" disabled={busy}>Save</button>\n' +
      "```\n\n" +
      "This is a warning today and an error in a later version.",
  },

  /**
   * The order guard is taken for BOTH halves: a spread after either may replace it, and then the
   * two attributes this reports as disagreeing are not the two that render.
   */
  evenWhenSpreading: true,

  read(_element, { tag, has, truth, overwritable, at }: ElementContext) {
    if (tag === undefined) return [];

    const found: AriaThatContradictsTheTagIssue[] = [];
    for (const [html, aria] of SAYS_THE_SAME) {
      if (!has(html) || !has(aria)) continue;
      // The HTML attribute has to be ON — `disabled={false}` says nothing to contradict — and the
      // ARIA one has to say FALSE. Anything unreadable on either side leaves the pair alone.
      if (truth(html) !== true || truth(aria) !== false) continue;
      if (overwritable(html) || overwritable(aria)) continue;

      found.push({ tag, html, aria, ...positionOf(at) });
    }
    return found;
  },
} as const satisfies ElementRule<AriaThatContradictsTheTagIssue>;
