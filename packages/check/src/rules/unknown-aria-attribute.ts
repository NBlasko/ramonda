import ts from "typescript";
import { positionOf } from "../syntax";
import { ARIA_ATTRIBUTES } from "./aria";
import { openingOf } from "./element";
import type { ElementRule } from "./rule";

/**
 * An `aria-*` attribute the specification does not have.
 *
 * The plain typo is most of it — `aria-require`, `aria-checkd`, `aria-descibedby` — and it fails
 * silently: the browser keeps any attribute you write, so the name is visible in the inspector and
 * assistive technology never looks at it.
 *
 * ## The CASE half, and why it is now only reported inside SVG
 *
 * This rule shipped saying that a wrong case was the interesting half — that `aria-labelledBy`
 * reaches the DOM as a different attribute from `aria-labelledby`. **Measured through
 * `renderToString`, that is false for an HTML element.** Attributes there go through
 * `setAttribute`, which the HTML specification lowercases, so the attribute arrives correctly
 * spelled and works. Reporting it was reporting correct markup, which is the one kind of mistake
 * this package treats as fatal to its own usefulness.
 *
 * It is true inside SVG. Those attributes go through `setAttributeNS(null, name)`, which writes the
 * name verbatim — measured the same way, on the same render — so a case-only difference there
 * really is an attribute nothing reads. That is where the rule keeps it, and `inSvg` on the element
 * context is what tells the two apart.
 *
 * A name that is wrong in more than its case is still reported everywhere: `aria-labeledBy` is not
 * `aria-labelledby` in any namespace.
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

  /**
   * A misspelling is in the source whatever the spread does.
   *
   * The family goes quiet on a spreading element because a spread may CARRY the attribute a rule
   * misses — `<img {...rest} />` may well have its `alt`. This rule misses nothing: the wrong name
   * is written on the tag. Measured on `fixtures/spread-a11y`, where
   * `<div {...rest} aria-lablled="Filters" />` went unreported while the identical line without the
   * spread was reported one line down.
   *
   * No order guard, and NOT because a spread cannot reach it — a later spread carrying `undefined`
   * really does remove an attribute, measured through `renderToString`. Because this rule is about
   * what was WRITTEN: `aria-lablled` is a typo whether the browser ends up seeing it or not, and
   * the attribute the author meant is missing either way. `unknown-role` is the other kind and
   * takes the guard.
   */
  evenWhenSpreading: true,

  read(element, { tag, inSvg }) {
    // Components too: `<Panel aria-lablled="x" />` is a prop with a name, and the mistake is the
    // same one whether the tag is markup or a class that will pass it through.
    void tag;
    const found: UnknownAriaAttributeIssue[] = [];

    for (const attribute of openingOf(element).attributes.properties) {
      if (!ts.isJsxAttribute(attribute)) continue;
      const written = attribute.name.getText();
      if (!written.toLowerCase().startsWith("aria-")) continue;
      if (ARIA_ATTRIBUTES.has(written)) continue;

      /**
       * A difference of CASE ALONE, on anything that is not an SVG element, is not a fault.
       *
       * `setAttribute` lowercases for HTML, so the attribute arrives correctly spelled and does
       * its job — measured, not assumed. A component falls here too: whatever it passes the prop
       * to, it reaches the DOM through the same call.
       */
      if (!inSvg && ARIA_ATTRIBUTES.has(written.toLowerCase())) continue;

      const meant = probably(written);
      found.push({ attribute: written, ...(meant ? { meant } : {}), ...positionOf(attribute) });
    }

    return found;
  },
} as const satisfies ElementRule<UnknownAriaAttributeIssue>;
