import { positionOf } from "../syntax";
import { ROLES } from "./aria";
import { ARIA_BELONGS_TO, whereItBelongs } from "./ariaBelongsTo";
import type { ElementContext, ElementRule } from "./rule";

/**
 * An `aria-*` written beside a `role` that does not have it.
 *
 * `<div role="button" aria-checked="true">` is the shape. ARIA defines every non-global state as
 * belonging to particular roles, and exposes it only there — `aria-checked` belongs to `checkbox`,
 * `radio`, `switch` and their kin, and a `button` is none of them. The attribute lands in the DOM,
 * updates as the state changes, and is announced by nobody.
 *
 * The author is usually one word from correct, which is what makes it worth reporting rather than
 * leaving: they built a toggle, reached for `role="button"` because that is what it looks like, and
 * wired up the state that would have worked on `role="switch"`.
 *
 * This is the other half of `aria-state-with-no-role`. That one asks about an element with NO role
 * and is certain because a `<div>` has none; this one asks about a role that is WRITTEN, and is
 * certain because the role is right there in the source. Between them they need no table of
 * implicit roles for HTML at all — which is the reason both can ship.
 *
 * ## The data is attribute-first, and partial on purpose
 *
 * See {@link ARIA_BELONGS_TO}. Reading the specification role-first would mean getting inheritance
 * right for every role in ARIA, and a superclass property missed anywhere is a report against
 * correct markup. Attribute-first, the inheritance is already flattened and each list is short
 * enough to check by eye.
 *
 * Only attributes with a small, famous, stable role set are covered, and every doubt inside a list
 * is resolved by INCLUDING the role — an extra one costs a missed report, a missing one costs a
 * false report, and those are not the same price. An attribute that is not in the table is never
 * judged, and neither is a role this does not recognise: an unknown role is `unknown-role`'s
 * report, and it says more about it than this could.
 */
export interface AriaStateTheRoleDoesNotHaveIssue {
  /** The role that was written. */
  role: string;
  /** The attribute, exactly as written. */
  attribute: string;
  /** The roles it does belong to, shortened to the ones worth naming. */
  belongsTo: string;
  file: string;
  line: number;
  column: number;
}

export const ariaStateTheRoleDoesNotHave = {
  id: "aria-state-the-role-does-not-have",

  report: {
    severity: "error",
    reportedWhen: "an `aria-*` sits beside a `role` that does not support it, so nothing exposes it",
    heading: (found) => `${found.length} accessibility state(s) the element's role does not have:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    \`${issue.attribute}\` on \`role="${issue.role}"\` — it belongs to \`${issue.belongsTo}\`, so nothing announces it here.`,
    ],
    advice:
      "ARIA defines every non-global state as belonging to particular roles and exposes it only\n" +
      "there. Written beside a role that does not have it, the attribute lands in the DOM, updates\n" +
      "as the state changes, and is announced by nobody.\n\n" +
      'The answer is usually one word. A toggle built as `role="button"` with `aria-checked` wants\n' +
      '`role="switch"`; a list item with `aria-selected` wants `role="option"` inside a\n' +
      '`role="listbox"`; a header with `aria-sort` wants `role="columnheader"` inside a table.\n\n' +
      "Where the role really is the right one, the state is the wrong one: a `button` that opens\n" +
      "something uses `aria-expanded`, and a `button` that stays pressed uses `aria-pressed`.\n\n" +
      "Not every attribute is judged here. Only those whose set of roles is small and settled — and\n" +
      "where this is unsure whether a role belongs, it assumes it does, because a missed report is\n" +
      "cheaper than a wrong one.\n\n",
  },

  /**
   * The `role` is read as a VALUE, so the order guard is taken for it. Each attribute is asked
   * about its own position too: a spread after one may replace it with something that belongs.
   */
  evenWhenSpreading: true,

  read(_element, { attr, has, attributes, overwritable }: ElementContext) {
    const written = attr("role")?.trim().toLowerCase();
    // No role, or one this cannot read — the sibling rule has the first and nobody has the second.
    if (written === undefined || has("role") === false) return [];
    // A chain takes the first role the browser understands, and judging one entry of a list of
    // alternatives is not a question about the element.
    if (written.includes(" ")) return [];
    // An unknown role is `unknown-role`'s report, and two on one line teaches a reader to skim.
    if (!ROLES.has(written)) return [];
    if (overwritable("role")) return [];

    const found: AriaStateTheRoleDoesNotHaveIssue[] = [];
    for (const attribute of attributes) {
      const lowered = attribute.name.toLowerCase();
      const roles = ARIA_BELONGS_TO.get(lowered);
      if (roles === undefined || roles.has(written)) continue;
      if (overwritable(lowered)) continue;

      found.push({
        role: written,
        attribute: attribute.name,
        belongsTo: whereItBelongs(lowered) ?? "",
        ...positionOf(attribute.at),
      });
    }
    return found;
  },
} as const satisfies ElementRule<AriaStateTheRoleDoesNotHaveIssue>;
