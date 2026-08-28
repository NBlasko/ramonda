import { positionOf } from "../syntax";
import { ARIA_ATTRIBUTES, GLOBAL_ARIA, NO_IMPLICIT_ROLE } from "./aria";
import type { ElementContext, ElementRule } from "./rule";

/**
 * An `aria-*` that belongs to a ROLE, written on an element that has none.
 *
 * ARIA divides its states and properties in two. A GLOBAL one — `aria-label`, `aria-hidden`,
 * `aria-describedby` — is exposed on any element in the accessibility tree. Every other one is
 * defined BY a role and is exposed only where that role supports it. `aria-expanded` belongs to
 * `button`, `combobox`, `link` and a handful more; `aria-checked` to `checkbox`, `radio`, `switch`
 * and `option`; `aria-selected` to `option`, `row`, `tab`.
 *
 * Written on a bare `<div>`, none of them says anything at all. The element is exposed with no
 * role, so there is nothing for the state to be a state OF, and assistive technology has nothing to
 * announce. `<div aria-expanded={open}>` beside a custom dropdown is the commonest shape of it —
 * the author wired the value up correctly and it reaches nobody.
 *
 * The fault is invisible in every way a fault can be. The markup is valid, the attribute lands in
 * the DOM and is visible in the inspector, the value updates as the state changes, and nothing
 * anywhere reports it.
 *
 * ## Why this is narrower than the spec, deliberately
 *
 * The full question — "does this element's role support this attribute" — needs a role for every
 * tag in HTML and a supported-properties list for every role in ARIA. Both are large, both are easy
 * to get subtly wrong, and being wrong here means reporting correct markup, which is the one thing
 * this package treats as fatal to its own usefulness.
 *
 * So it asks the half that is CERTAIN: a `<div>` or a `<span>` has no implicit role, and if no
 * `role` is written either then the element has no role, full stop. No table of roles is consulted
 * because none is needed. The other half of the question is left to a later rule that can afford
 * the data — and a silence there costs a missed report, not a false one.
 *
 * A `role` written but unreadable — `role={kind}` — is a role this cannot judge, and it says
 * nothing about it.
 */
export interface AriaStateWithNoRoleIssue {
  /** The element it was written on. */
  tag: string;
  /** The attribute, exactly as written. */
  attribute: string;
  file: string;
  line: number;
  column: number;
}

export const ariaStateWithNoRole = {
  id: "aria-state-with-no-role",

  report: {
    severity: "warn",
    reportedWhen: "an `aria-*` belonging to a role is written on an element that has no role",
    heading: (found) => `${found.length} accessibility state(s) with no role to belong to:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.tag} ${issue.attribute}={…}> has no role, so nothing is announced for it.`,
    ],
    advice:
      "ARIA has two kinds of attribute. A GLOBAL one — `aria-label`, `aria-hidden`,\n" +
      "`aria-describedby` — works on anything. Every other one is defined BY a role and is exposed\n" +
      "only where that role supports it.\n\n" +
      "A `<div>` and a `<span>` have no role of their own, so a state written on one has nothing to\n" +
      "be a state of. The value is in the DOM, it updates, and no assistive technology ever\n" +
      "announces it.\n\n" +
      'Give the element the role the state belongs to — `role="button"` for `aria-expanded`,\n' +
      '`role="checkbox"` for `aria-checked`, `role="option"` for `aria-selected` — and with it the\n' +
      "rest of what that role needs: a name, a tab stop, and a keyboard path.\n\n" +
      "Or use the element that has the role already. `<button aria-expanded>` needs no role written\n" +
      "at all, and arrives focusable and announced without a line being spent on it.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  /**
   * A `@Host` props bag configures a real element, and a state written there is the same state.
   *
   * `evenWhenSpreading` with a guard of its own: a spread may be carrying the `role` that would
   * make the attribute mean something, so an element that spreads at all is left alone. That is the
   * "an absent attribute may arrive in the spread" case the family guard exists for — taken here by
   * hand because this rule needs the rest of the guard lifted.
   */
  evenWhenSpreading: true,

  read(_element, { tag, has, attributes, spreads }: ElementContext) {
    if (tag === undefined || !NO_IMPLICIT_ROLE.has(tag)) return [];
    // A `role` written at all — readable or not — is a role this rule may not claim is absent.
    if (has("role")) return [];
    // And a spread may be carrying one.
    if (spreads) return [];

    const found: AriaStateWithNoRoleIssue[] = [];
    for (const attribute of attributes) {
      const written = attribute.name;
      const lowered = written.toLowerCase();
      if (!lowered.startsWith("aria-")) continue;
      // A misspelling is `unknown-aria-attribute`'s report, and it says more about it than this
      // could. Two rules on one line is how a reader learns to skim past both.
      if (!ARIA_ATTRIBUTES.has(lowered)) continue;
      if (GLOBAL_ARIA.has(lowered)) continue;

      found.push({ tag, attribute: written, ...positionOf(attribute.at) });
    }
    return found;
  },
} as const satisfies ElementRule<AriaStateWithNoRoleIssue>;
