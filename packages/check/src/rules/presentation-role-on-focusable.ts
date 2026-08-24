import { positionOf } from "../syntax";
import { focusableByTag } from "./aria-hidden-on-focusable";
import type { ElementContext, HostElementRule } from "./rule";

/**
 * `role="presentation"` on an element a keyboard can still focus — where the spec IGNORES the role.
 *
 * `presentation` and its synonym `none` say "this element is scaffolding; expose its children and
 * not it". ARIA resolves the conflict when that cannot hold: **an element that is focusable keeps
 * its implicit role and the presentational one is dropped**. So the author asked for the element to
 * disappear from the accessibility tree and it did not — silently, with nothing at build time and
 * nothing at runtime to say so.
 *
 * What a reader gets is the shape the author was trying to avoid: they tab onto something announced
 * as a button, or a link, or a text box, that was meant to be invisible scaffolding. Which of the
 * two the author wanted — the element gone, or the element focusable — is not a question this can
 * answer, and the report says so rather than guessing.
 *
 * ## Why an error would be wrong here, and a warning is not
 *
 * The page is not broken. The element keeps its DEFAULT semantics, which are usually reasonable —
 * so this is an intention that failed rather than markup that misleads. `aria-hidden-on-focusable`
 * is the sibling claim about the same element and carries the same severity for the same reason.
 *
 * ## The half this deliberately does NOT report
 *
 * The spec drops a presentational role for a second reason too: a global `aria-*` attribute on the
 * same element. That half is spec-true and is left alone, because it is the half people argue
 * about — `<div role="presentation" aria-label="…">` is written on purpose often enough that
 * reporting it would be reporting a tradeoff rather than a fault. And one member of that set makes
 * it plainly wrong: `aria-hidden="true"` takes the element out of the tree anyway, so the
 * presentational role being dropped changes nothing at all.
 */
export interface PresentationRoleOnFocusableIssue {
  /** The element it was written on. */
  tag: string;
  /** Which of the two synonyms was written, so the report quotes the line. */
  role: "presentation" | "none";
  /** Why it is focusable — the tag itself, or a `tabIndex` that put it there. */
  because: "the tag" | "tabIndex";
  file: string;
  line: number;
  column: number;
}

/** `none` is the synonym ARIA added because `presentation` reads like a visual instruction. */
const PRESENTATIONAL: ReadonlySet<string> = new Set(["presentation", "none"]);

export const presentationRoleOnFocusable = {
  id: "presentation-role-on-focusable",

  report: {
    severity: "warn",
    reportedWhen:
      '`role="presentation"` is written on an element a keyboard can still focus, where the role is ignored',
    heading: (found) => `${found.length} presentational role(s) the accessibility tree keeps anyway:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.tag} role="${issue.role}"> is still focusable — ${
        issue.because === "the tag" ? `\`<${issue.tag}>\` is focusable on its own` : "`tabIndex` put it there"
      }, so the role is dropped.`,
    ],
    advice:
      "`presentation` and `none` say the element is scaffolding: expose what is inside it, not it.\n" +
      "ARIA drops that role when it cannot hold, and a FOCUSABLE element is the case — it keeps its\n" +
      "implicit role. So the element stays in the accessibility tree announced as whatever it\n" +
      "really is, which is the thing the role was written to prevent.\n\n" +
      "Two answers, and which one is right is a question about the page rather than the markup:\n\n" +
      "Take it OUT of the tab order — `tabIndex={-1}` on a tag that is not focusable on its own, or\n" +
      "a plain `<div>`/`<span>` instead of a `<button>`. Scaffolding a keyboard can reach is not\n" +
      "scaffolding.\n\n" +
      "Or keep it focusable and drop the role. If a reader can tab to it, it is a control, and it\n" +
      "needs a name and a role that says what it does.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  /**
   * A `@Host` props bag configures a real element, and a role written there is the same role.
   *
   * No order guard, and this one is deliberate rather than copied: the claim turns on the ROLE and
   * on the tag, and a spread after the role could replace it — so the guard IS taken, below, for
   * the role. The tag is not an attribute and no spread reaches it.
   */
  alsoOnHost: true,
  evenWhenSpreading: true,

  read(_element, context: ElementContext) {
    const { tag, attr, number, overwritable, spreads, at } = context;
    if (tag === undefined) return [];

    const written = attr("role")?.trim().toLowerCase();
    if (written === undefined || !PRESENTATIONAL.has(written)) return [];
    // A spread written after the role may replace it, and then there is no claim to make.
    if (overwritable("role")) return [];

    /**
     * `tabIndex` first, because it is the stronger fact — the same order the sibling takes, and for
     * the same reason: `tabIndex={0}` makes a `<div>` focusable, and `tabIndex={-1}` takes a
     * `<button>` back out, which is one of the two things this rule advises.
     */
    const tabIndex = number("tabIndex");
    if (tabIndex !== undefined) {
      if (overwritable("tabIndex")) return [];
      return tabIndex >= 0
        ? [{ tag, role: written as "presentation" | "none", because: "tabIndex" as const, ...positionOf(at) }]
        : [];
    }

    if (!focusableByTag(tag, context)) return [];

    /**
     * The tag branch, and the one place a spread on EITHER side matters.
     *
     * `<button role="presentation">` is reported for what the tag is — but `tabIndex={-1}` takes it
     * back out of the tab order and is one of the two fixes this rule advises, so a spread anywhere
     * may be carrying exactly that. The branch above needs no such question: its `tabIndex` is
     * written down, and only what comes after it can reach it.
     */
    if (spreads) return [];

    return [{ tag, role: written as "presentation" | "none", because: "the tag" as const, ...positionOf(at) }];
  },
} as const satisfies HostElementRule<PresentationRoleOnFocusableIssue>;
