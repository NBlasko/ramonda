import ts from "typescript";
import { positionOf } from "../syntax";
import { ARIA_ATTRIBUTES } from "./aria";
import { openingOf } from "./element";
import type { ElementRule } from "./rule";

/**
 * An `aria-*` attribute the specification does not have.
 *
 * The interesting half of this rule is not the invented name — it is the CASE. HTML attribute names
 * are lowercase; JSX writes down what you typed. So `aria-labelledBy` reaches the DOM as an
 * attribute called `aria-labelledby`-but-not-quite, assistive technology never looks at it, and
 * nothing anywhere says a word. It looks right in the source, which is the whole problem.
 *
 * The other half is the plain typo — `aria-require`, `aria-checkd`, `aria-descibedby` — which fails
 * the same way and just as quietly.
 */
export interface UnknownAriaAttributeIssue {
  /** What was written, exactly as written. */
  attribute: string;
  /** The real attribute it was probably meant to be, when one is obvious. */
  meant?: string;
  file: string;
  line: number;
  column: number;
}

/**
 * The attribute this was probably meant to be, or nothing.
 *
 * Only two answers are offered, and both are certain rather than clever: the same name in the right
 * case, and the same name with one character out. Anything looser starts guessing, and a report
 * that guesses wrong sends a reader to change a line that was not the mistake.
 */
function probably(written: string): string | undefined {
  const lowered = written.toLowerCase();
  if (ARIA_ATTRIBUTES.has(lowered)) return lowered;

  for (const known of ARIA_ATTRIBUTES) {
    if (Math.abs(known.length - lowered.length) > 1) continue;
    if (oneEditApart(known, lowered)) return known;
  }
  return undefined;
}

/** Whether two strings differ by a single insertion, deletion or substitution. */
function oneEditApart(a: string, b: string): boolean {
  if (a === b) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];

  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i += 1;
      j += 1;
      continue;
    }
    if (++edits > 1) return false;
    // A substitution advances both; an insertion advances only the longer one.
    if (shorter.length === longer.length) i += 1;
    j += 1;
  }
  return edits + (longer.length - j) + (shorter.length - i) <= 1;
}

export const unknownAriaAttribute = {
  id: "unknown-aria-attribute",

  report: {
    severity: "warn",
    reportedWhen: "an `aria-*` attribute is not a name the ARIA specification has",
    heading: (found) => `${found.length} \`aria-*\` attribute(s) that do not exist:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    \`${issue.attribute}\`` +
        (issue.meant ? ` — did you mean \`${issue.meant}\`?` : " is not in the ARIA vocabulary."),
    ],
    advice:
      "An `aria-*` name the specification does not have is not a smaller version of the right one —\n" +
      "it is an attribute nothing reads. Assistive technology ignores it, the browser keeps it, and\n" +
      "the source looks correct.\n\n" +
      "The commonest cause is CASE. HTML attribute names are lowercase and JSX writes what you\n" +
      "typed, so `aria-labelledBy` is a different attribute from `aria-labelledby` and does nothing.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(element, { tag }) {
    // Components too: `<Panel aria-lablled="x" />` is a prop with a name, and the mistake is the
    // same one whether the tag is markup or a class that will pass it through.
    void tag;
    const found: UnknownAriaAttributeIssue[] = [];

    for (const attribute of openingOf(element).attributes.properties) {
      if (!ts.isJsxAttribute(attribute)) continue;
      const written = attribute.name.getText();
      if (!written.toLowerCase().startsWith("aria-")) continue;
      if (ARIA_ATTRIBUTES.has(written)) continue;

      const meant = probably(written);
      found.push({ attribute: written, ...(meant ? { meant } : {}), ...positionOf(attribute) });
    }

    return found;
  },
} as const satisfies ElementRule<UnknownAriaAttributeIssue>;
