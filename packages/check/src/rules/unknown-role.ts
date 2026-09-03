import { positionOf } from "../syntax";
import { ABSTRACT_ROLES, ROLES } from "./aria";
import type { ElementRule } from "./rule";

/**
 * A `role` that is not one, or one the specification forbids in markup.
 *
 * Two faults with two different causes, told apart because the advice is different.
 *
 * An UNKNOWN role is usually a typo or a wish — `role="tabpane"`, `role="dropdown"`. The browser
 * keeps the attribute and the accessibility tree ignores it, so the element keeps whatever
 * semantics its tag already had, silently.
 *
 * An ABSTRACT role is somebody reading the specification's inheritance diagram and taking a branch
 * for a leaf. `widget`, `composite`, `landmark` and the rest exist to organise the vocabulary; the
 * spec says in as many words that they are "not permitted in content". A reader who writes one is
 * not confused about spelling, they are looking at the right document and picking the wrong row.
 */
export interface UnknownRoleIssue {
  /** What was written. */
  role: string;
  /** Which fault it is, because the two need different advice. */
  kind: "unknown" | "abstract";
  file: string;
  line: number;
  column: number;
}

export const unknownRole = {
  id: "unknown-role",

  report: {
    severity: "error",
    reportedWhen: "a `role` names nothing, or names an abstract role that markup may not use",
    heading: (found) => `${found.length} \`role\` attribute(s) that do not name a usable role:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      issue.kind === "abstract"
        ? `    role="${issue.role}" is an ABSTRACT role, which the specification does not permit in markup.`
        : `    role="${issue.role}" is not a role.`,
    ],
    advice:
      "A `role` the accessibility tree does not recognise is not a weaker role — it is none. The\n" +
      "browser keeps the attribute, nothing reads it, and the element keeps whatever semantics its\n" +
      "tag already had.\n\n" +
      "An ABSTRACT role is a different mistake: `widget`, `composite`, `landmark`, `section` and the\n" +
      "rest are there to organise the vocabulary, and the specification says they are not permitted\n" +
      "in content. Pick the concrete role underneath the one you found.\n\n" +
      "Before reaching for `role` at all, check whether a tag already says it. `<nav>` is\n" +
      '`role="navigation"` and `<button>` is `role="button"`, and the tag brings behaviour the\n' +
      "attribute does not.\n\n" +
      "A role this cannot read — `role={kind}` — is never reported.\n\n",
  },

  /**
   * Reported past a spread, but only from the side of it a spread cannot reach over.
   *
   * This is a rule about what the element WILL BE, so it takes the guard the family would
   * otherwise give it:
   * `<div role="buton" {...rest} />` may end up with whatever role `rest` carries and is left
   * alone, while `<div {...rest} role="buton" />` ends up with `buton` whatever `rest` holds,
   * because the later attribute wins. Measured on `fixtures/spread-a11y` — the second shape was
   * silent, beside an identical line without the spread that was reported.
   */
  evenWhenSpreading: true,

  read(_element, { attr, overwritable, at }) {
    const written = attr("role");
    if (written === undefined) return [];
    // A spread written AFTER the role can replace it, and then nothing here is provable.
    if (overwritable("role")) return [];

    const found: UnknownRoleIssue[] = [];
    /**
     * A role attribute may list SEVERAL, and the first one the browser understands wins — a
     * fallback chain. So each token is judged on its own, and a chain with one good role in it is
     * still reported for the bad ones, because the bad ones are still typos.
     */
    for (const token of written.trim().split(/\s+/)) {
      if (token === "") continue;
      const role = token.toLowerCase();
      if (ROLES.has(role)) continue;
      found.push({
        role: token,
        kind: ABSTRACT_ROLES.has(role) ? "abstract" : "unknown",
        ...positionOf(at),
      });
    }

    return found;
  },
} as const satisfies ElementRule<UnknownRoleIssue>;
