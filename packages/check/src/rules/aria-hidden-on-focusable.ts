import { positionOf } from "../syntax";
import type { ElementContext, ElementRule } from "./rule";

/**
 * `aria-hidden="true"` on something a keyboard can still reach.
 *
 * The two things it does are not the same thing, and that is the whole fault. `aria-hidden` removes
 * an element from the accessibility tree; it does NOT remove it from the tab order. So a button
 * hidden this way is still tabbed to, still focused, and at the moment it takes focus a screen
 * reader has nothing to announce — the user is somewhere the software cannot name.
 *
 * It is worth being precise about who this hurts, because it is not only screen-reader users: it is
 * anybody whose reading of the page comes through the accessibility tree, landing on a control that
 * the page insists is not there. The usual intent was to hide something decorative, and the usual
 * fix is one attribute away.
 *
 * ## What makes it provable
 *
 * Focusability is decided by the tag in almost every case — a `<button>` is focusable wherever it
 * is written — so this needs no type and no composed tree. The two shapes that are NOT inherent are
 * read as literals or not at all: `tabIndex={0}` puts anything in the tab order, and `<a>` is
 * focusable only with an `href`. Anything written as an expression this cannot read makes the rule
 * go quiet, per the package's contract, and a spreading element never reaches a rule at all.
 */
export interface AriaHiddenOnFocusableIssue {
  /** The tag it was written on, so a report reads like the source. */
  tag: string;
  /** Why this element takes focus — the tag itself, or the `tabIndex` that put it there. */
  because: "the tag" | "tabIndex";
  file: string;
  line: number;
  column: number;
}

/**
 * Tags a keyboard reaches without anything being written on them.
 *
 * `a` is deliberately absent: it is focusable only with an `href`, which is a question about an
 * attribute rather than about the tag, and is asked below. `input` is here because every type of it
 * is focusable except `hidden`, which is also asked below rather than assumed.
 */
const FOCUSABLE_TAGS: ReadonlySet<string> = new Set(["button", "input", "select", "textarea", "summary", "iframe"]);

/** Whether the tag alone puts this element in the tab order, given what is written on it. */
/**
 * Exported because `presentation-role-on-focusable` asks the same question about the same element.
 *
 * The two rules are siblings — one is about an element hidden from the accessibility tree while
 * still in the tab order, the other about an element declared presentational while still in it —
 * and they have to agree about what "focusable" means, or the same `<summary>` is focusable to one
 * of them and not to the other.
 */
export function focusableByTag(tag: string, { attr, has }: ElementContext): boolean {
  if (tag === "a") return has("href");
  if (tag === "input") return attr("type") !== "hidden";
  return FOCUSABLE_TAGS.has(tag);
}

/**
 * Whether what is written on an element puts it in the TAB ORDER — the whole question, once.
 *
 * Three answers. `{ because }` and `false` are proved from what is written down; `undefined` is
 * "not provable here", which is a spread that may be carrying the `tabIndex={-1}` that settles it.
 *
 * ## Why this is a shared reader and not a rule's private helper
 *
 * Two rules ask it, of two different elements: this one about the element `aria-hidden` is ON, and
 * `aria-hidden-around-something-focusable` about an element INSIDE that subtree. It is the same
 * question about the same kind of thing, and they have to give the same answer.
 *
 * They did not. The other rule had written its own walk over the raw JSX attributes, and it
 * disagreed twice — measured with a plant, both times reporting markup that is correct:
 *
 * - `<input type={HIDDEN}>` where `const HIDDEN = "hidden"`. `attr` follows a name to the value it
 *   holds; a walk that accepts only a string literal does not, so the one input that is NOT
 *   focusable read as focusable.
 * - `<button {...rest}>`. `rest` may carry the `tabIndex={-1}` that takes it out of the tab order,
 *   which is the correct way to write this — and the guard for that lived only here.
 *
 * That is this package's standing lesson: two rules answering one question two different ways, and
 * one of them is wrong. The fix is never the rule, it is the reader.
 */
export function inTheTabOrder(context: ElementContext): { because: "tabIndex" | "the tag" } | false | undefined {
  const { tag } = context;
  if (tag === undefined) return undefined;

  // `tabIndex` first, because it is the stronger fact: it can put a `<div>` in the tab order, and
  // `tabIndex={-1}` takes a `<button>` back out of it. Asking the tag first would call
  // `<button tabIndex={-1}>` focusable, which is the correct way to write one that is not.
  const tabIndex = context.number("tabIndex");
  if (tabIndex !== undefined) {
    // A spread after it may replace this number, or take the attribute away entirely.
    if (context.overwritable("tabIndex")) return undefined;
    return tabIndex >= 0 ? { because: "tabIndex" } : false;
  }

  if (!focusableByTag(tag, context)) return false;

  /**
   * The tag branch, and the one place a spread on EITHER side matters.
   *
   * `<button>` is in the tab order for what the tag is. But `tabIndex={-1}` takes it back out, and
   * a spread anywhere on the tag may be carrying exactly that, since nothing here can see what an
   * absent attribute would have said. The branch above needs no such question: the `tabIndex` is
   * written down, and only what comes after it can reach it.
   */
  if (context.spreads) return undefined;

  return { because: "the tag" };
}

export const ariaHiddenOnFocusable = {
  id: "aria-hidden-on-focusable",

  report: {
    severity: "warn",
    reportedWhen: '`aria-hidden="true"` is written on an element a keyboard can still focus',
    heading: (found) => `${found.length} focusable element(s) hidden from the accessibility tree:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.tag} aria-hidden="true"> is still in the tab order — ${
        issue.because === "the tag" ? `\`<${issue.tag}>\` is focusable on its own` : "`tabIndex` put it there"
      }.`,
    ],
    advice:
      "`aria-hidden` takes an element out of the accessibility tree. It does NOT take it out of the\n" +
      "tab order, and those are different lists. What is left is a control a keyboard still lands\n" +
      "on and that a screen reader cannot announce — focus goes somewhere the software says is not\n" +
      "there.\n\n" +
      "Pick the one that was meant. To hide it from everyone, `hidden` or `display: none` removes it\n" +
      "from both lists. To keep it visible but skip it, `disabled` on a form control, or\n" +
      "`tabIndex={-1}` beside the `aria-hidden` so the two agree. To hide only the DECORATION inside\n" +
      "a control, move `aria-hidden` onto the icon and leave the control itself announced.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  evenWhenSpreading: true,

  read(_element, context) {
    const { tag } = context;
    if (tag === undefined) return [];

    // Only a literal TRUE is a claim, in any of the three spellings that mean it — `aria-hidden`,
    // `{true}` and `"true"` all reach the element the same way. `aria-hidden={busy}` may be either,
    // and a rule that guessed would report the correct half of it.
    if (context.truth("aria-hidden") !== true) return [];
    /**
     * The `aria-hidden` half has to survive the spread; the other half is asked below.
     *
     * A spread written after it can replace it or remove it outright — measured through
     * `renderToString` — and then the element this reports is not the element that renders.
     */
    if (context.overwritable("aria-hidden")) return [];

    // What puts an element in the tab order is one question, and `inTheTabOrder` is where it is
    // asked — by this rule about the element `aria-hidden` is on, and by the sibling rule about an
    // element inside the subtree.
    const order = inTheTabOrder(context);
    if (order === false || order === undefined) return [];

    return [{ tag, because: order.because, ...positionOf(context.at) }];
  },
} as const satisfies ElementRule<AriaHiddenOnFocusableIssue>;
