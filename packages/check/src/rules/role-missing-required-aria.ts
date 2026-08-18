import { positionOf } from "../syntax";
import { ROLE_REQUIRES, STATE_FROM_THE_ELEMENT } from "./aria";
import { openingOf } from "./element";
import type { ElementRule } from "./rule";

/**
 * A role that promises something the element never says.
 *
 * A `role` is a contract with assistive technology: it says what the element IS, and some roles
 * cannot mean anything on their own. `role="checkbox"` announces a checkbox, and the first thing
 * anyone wants to know about a checkbox is whether it is checked — which lives in `aria-checked`
 * and nowhere else, because a `div` has no checked-ness of its own. Without it the control is
 * announced as a checkbox in an unknowable state, which is worse than not claiming to be one:
 * a plain `div` at least reads as what it is.
 *
 * The same shape each time. `role="heading"` with no `aria-level` has no place in the outline;
 * `role="slider"` with no `aria-valuenow` is a slider at no value; `role="combobox"` that cannot
 * say whether it is open is a text field with a decoration on it.
 *
 * **Nothing fails.** The role is a real role, so the sibling rule is satisfied; the attribute that
 * is missing is missing, which no parser minds. The page works for everyone who can see it.
 */
export interface RoleMissingRequiredAriaIssue {
  /** The role that was claimed. */
  role: string;
  /** The tag it was claimed on. */
  tag: string;
  /** What the specification requires and the element does not have. */
  missing: readonly string[];
  file: string;
  line: number;
  column: number;
}

/**
 * A role written without the states and properties it cannot work without.
 *
 * A WARNING, which is this repository's rule for a new rule. Nothing in this repository trips it —
 * measured across every app and package.
 *
 * **Only an explicit `role`.** An implicit one — `<h2>`, `<input type="checkbox">` — is the host
 * language's, and the host language supplies what it needs: a heading element has a level from its
 * own tag name, and a checkbox input has checked-ness of its own. Judging those would report every
 * correct `<h2>` there is.
 *
 * The value is only judged when it is a single literal role. A fallback chain — `role="none
 * presentation"` — is a list of alternatives and the browser takes the first it understands, which
 * is a question about the whole chain rather than about one entry.
 */
export const roleMissingRequiredAria = {
  id: "role-missing-required-aria",

  report: {
    severity: "warn",
    reportedWhen: "an explicit `role` is written without the `aria-*` its specification requires",
    heading: (found) => `${found.length} role(s) missing what the specification requires of them:`,
    // One line, and no attempt to say what each role MEANS: the first version ended every report
    // with "announces a heading nothing can describe", which is true of a checkbox's state and
    // nonsense about a heading's level. What is worth saying per issue is the fact; the reason is
    // the same reason every time, and it is in the advice below.
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.tag} role="${issue.role}"> has no ${issue.missing.map((name) => `\`${name}\``).join(" and no ")}, ` +
        `which the role requires.`,
    ],
    advice:
      "A role says what an element IS, and some roles mean nothing on their own. A `div` has no\n" +
      "checked-ness, no level and no value of its own, so a role claiming one of those has to be\n" +
      "given it — `aria-checked`, `aria-level`, `aria-valuenow`.\n\n" +
      "Nothing fails while this is wrong. The role is real, the missing attribute is simply absent,\n" +
      "and the page works for everyone who can see it. What a screen reader announces is a control\n" +
      "in a state it cannot report, which is worse than the plain element would have been.\n\n" +
      "The likeliest fix is not to add the attribute. A native element usually already is the thing\n" +
      'the role is claiming — `<input type="checkbox">`, `<h2>`, `<input type="range">` — and it\n' +
      "brings the state, the keyboard behaviour and the focus handling with it, none of which a\n" +
      "role provides.\n\n" +
      "Only an EXPLICIT role is judged: a native element's own role is the host language's, and it\n" +
      "supplies what it needs.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(element, { tag, attr, has }) {
    // Markup only: a `role` prop on a component is decided inside that component.
    if (tag === undefined) return [];
    // The element's own markup already carries the state — see `STATE_FROM_THE_ELEMENT`.
    if (STATE_FROM_THE_ELEMENT.has(tag)) return [];

    const role = attr("role")?.trim();
    // A fallback chain is a list of alternatives, and which one the browser takes is not a
    // question about any single entry.
    if (role === undefined || role.includes(" ")) return [];

    const required = ROLE_REQUIRES.get(role.toLowerCase());
    if (required === undefined) return [];

    // `has`, not `attr`: `aria-checked={checked}` is written, and whether the expression is right
    // is a different question from whether the attribute is there at all.
    const missing = required.filter((name) => !has(name));
    if (missing.length === 0) return [];

    const site = openingOf(element).attributes.properties.find(
      (property) => "name" in property && property.name?.getText().toLowerCase() === "role",
    );
    return [{ role, tag, missing, ...positionOf(site ?? element) }];
  },
} as const satisfies ElementRule<RoleMissingRequiredAriaIssue>;
