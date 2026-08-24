import { positionOf } from "../syntax";
import type { ElementContext, HostElementRule } from "./rule";

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

  alsoOnHost: true,

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

    // `tabIndex` first, because it is the stronger fact: it can put a `<div>` in the tab order, and
    // `tabIndex={-1}` takes a `<button>` back out of it. A rule that asked the tag first would
    // report `<button aria-hidden="true" tabIndex={-1}>`, which is the correct way to write this.
    const tabIndex = context.number("tabIndex");
    if (tabIndex !== undefined) {
      // A spread after it may replace this number, or take the attribute away entirely.
      if (context.overwritable("tabIndex")) return [];
      return tabIndex >= 0 ? [{ tag, because: "tabIndex" as const, ...positionOf(context.at) }] : [];
    }

    if (!focusableByTag(tag, context)) return [];

    /**
     * The tag branch, and the one place a spread on EITHER side matters.
     *
     * `<button aria-hidden="true">` is reported for what the tag is. But `tabIndex={-1}` takes it
     * back out of the tab order and is the correct way to write this — and a spread anywhere on
     * the tag may be carrying exactly that, since nothing here can see what an absent attribute
     * would have said. The other branch above needs no such question: the `tabIndex` is written
     * down, and only what comes after it can reach it.
     */
    if (context.spreads) return [];

    return [{ tag, because: "the tag" as const, ...positionOf(context.at) }];
  },
} as const satisfies HostElementRule<AriaHiddenOnFocusableIssue>;
