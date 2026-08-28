import { positionOf } from "../syntax";
import { isNamed } from "./naming";
import type { ElementRule } from "./rule";

/**
 * `role="region"` with nothing to name it, which is a landmark that never becomes one.
 *
 * `region` is the only landmark role the specification makes conditional on a name. WAI-ARIA is
 * explicit — *"Authors MUST give each element with role `region` a brief label"* — and *ARIA in
 * HTML* says what happens when they do not: an unnamed one is not exposed as a landmark. The
 * element becomes a generic box.
 *
 * So this is an INTENTION THAT FAILED rather than markup that misleads, and that is what makes it
 * worth a report. Somebody wrote `role="region"` for one reason: to put a section in the landmark
 * list a screen reader offers, so a reader can jump to it. Without the name it is not in that list,
 * nothing announces it, and the page behaves exactly as if the attribute had never been typed.
 * Nothing on screen looks wrong, and nothing ever will.
 *
 * ## Why a `<section>` with no name is NOT this
 *
 * `<section>` maps to `region` only when it HAS an accessible name, and to `generic` when it does
 * not. That is the mapping working as designed, not a failure: an unnamed `<section>` is ordinary,
 * correct markup that appears on nearly every page ever written, and reporting it would bury the
 * real fault under thousands of lines that are fine.
 *
 * The line is the WRITTEN role. An author who typed `role="region"` asked for a landmark; an author
 * who typed `<section>` asked for a section and gets a landmark only if they name it.
 *
 * ## What counts as a name
 *
 * `aria-labelledby`, `aria-label` or `title` — through the shared reader, so this rule and
 * `landmarks-that-cannot-be-told-apart` cannot come to disagree about what "named" means. An empty
 * one names nothing and is reported; one this cannot read is somebody naming it and is not.
 */
export interface RegionWithNoNameIssue {
  /** The tag it was written on, for a report that points at something a reader can find. */
  tag: string;
  file: string;
  line: number;
  column: number;
}

export const regionWithNoName = {
  id: "region-with-no-name",

  report: {
    severity: "warn",
    reportedWhen:
      '`role="region"` is written with no `aria-label`, `aria-labelledby` or `title`, so it is not a landmark at all',
    heading: (found) => `${found.length} \`region\` landmark(s) that never become one:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.tag} role="region"> has no name, so nothing exposes it as a landmark.`,
    ],
    advice:
      "`region` is the one landmark role the specification makes conditional on a name. Without\n" +
      "one it is not put in the landmark list, so it is not announced and cannot be jumped to —\n" +
      "the attribute does nothing at all, and the page looks exactly the same either way.\n\n" +
      "Name it:\n\n" +
      "```tsx\n" +
      '<div role="region" aria-label="Search filters">…</div>\n' +
      "```\n\n" +
      "Where a visible heading already says what the section is, point at that instead and the two\n" +
      "cannot drift apart:\n\n" +
      "```tsx\n" +
      '<h2 id="filters-heading">Search filters</h2>\n' +
      '<div role="region" aria-labelledby="filters-heading">…</div>\n' +
      "```\n\n" +
      'Do not put the word "region" in the name — the kind is announced already, and\n' +
      '`aria-label="Filters region"` is read out as "Filters region region".\n\n' +
      "If the section is not important enough to navigate to, it does not need the role. A plain\n" +
      "`<section>` or `<div>` is the right element, and an unnamed `<section>` is not this report:\n" +
      "it maps to a generic box by design rather than by mistake.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  // No `evenWhenSpreading`, deliberately: this reports an ABSENCE, a spread may be carrying the
  // name, and the family's default is to not ask a rule at all about a spreading element. Nothing
  // here has to test `spreads` for itself — `applyElement` has already decided.

  read(_element, { tag, attr, has, at }) {
    if (tag === undefined) return [];

    const written = attr("role")?.trim().toLowerCase();
    // A role this cannot READ may be anything, and a chain is a list of alternatives whose winner
    // is not a question about this element. Both are somebody else's answer, or nobody's.
    if (written === undefined || written.includes(" ")) return [];
    if (written !== "region") return [];

    if (isNamed({ has, attr })) return [];

    return [{ tag, ...positionOf(at) }];
  },
} as const satisfies ElementRule<RegionWithNoNameIssue>;
