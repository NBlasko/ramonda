import { BOOLEAN_ATTRIBUTES } from "@ramonda/dom-facts";
import ts from "typescript";
import { positionOf } from "../syntax";
import type { ElementRule, TextEdit } from "./rule";

/**
 * `disabled="false"` — a boolean attribute turned ON by a string that says off.
 *
 * A boolean attribute is true whenever it is PRESENT. The parser never reads the value, so the
 * string `"false"` puts the attribute in the document and the control is disabled — the exact
 * opposite of what the line says, written by somebody who meant the opposite.
 *
 * The fix is the boolean itself: `disabled={false}` removes the attribute, and removing it is the
 * only way HTML has of turning one off.
 *
 * ## The static twin of RMD029
 *
 * `@ramonda/core` reports this while it runs, from `debug/booleanAttribute.ts`, and only for markup
 * that actually renders. This is the same fault found in a branch nobody has opened.
 *
 * The two share the list that decides WHICH names are boolean — `BOOLEAN_ATTRIBUTES` in
 * `@ramonda/dom-facts`, put there so a second copy would not be made — so they cannot come to
 * disagree about whether a name is one. The outcome wording below is a copy; see the note on it.
 *
 * ## What is NOT this
 *
 * An `aria-*` is an enumerated STRING with three answers, and `aria-hidden="false"` means "not
 * hidden" — a real value rather than a mistake. A `data-*` is data that something reads back. Both
 * are absent from `BOOLEAN_ATTRIBUTES` for that reason, which is why this asks the table rather
 * than the shape of the value.
 */
export interface FalseOnABooleanAttributeIssue {
  /** The tag it was written on. */
  tag: string;
  /** The attribute, lowercased as the DOM stores it. */
  attribute: string;
  /** What the element will do, in core's own words. */
  outcome: string;
  /** Replacing the string with the boolean — see {@link TextEdit}. */
  edit?: TextEdit;
  file: string;
  line: number;
  column: number;
}

/**
 * What the element will DO, per attribute, so the report is about the outcome rather than the rule.
 *
 * A COPY of core's `OUTCOME`, and nothing enforces that it stays one — unlike the decorator tables,
 * which `scripts/check-decorator-duplication.mjs` pins in both directions because there a drift
 * changes the VERDICT and the advice built on it.
 *
 * This table cannot do that. Every entry is a description of what one attribute does, the set of
 * names is decided by `BOOLEAN_ATTRIBUTES` rather than here, and a name absent from this map still
 * reports — with the general sentence below. So the two packages can come to word one fault
 * differently, which is worth avoiding and is not worth a script: the failure is a less specific
 * report, never a wrong one.
 *
 * If that stops being true — if an entry here ever decides whether to report rather than how to say
 * it — this needs pinning the way the decorator tables are.
 */
const OUTCOME: Record<string, string> = {
  checked: "the box is checked",
  disabled: "the control is disabled and cannot be used",
  hidden: "the element is hidden",
  inert: "the subtree stops receiving events",
  multiple: "the control accepts several values",
  muted: "the media is muted",
  open: "the element is open",
  readonly: "the field cannot be edited",
  required: "the form will not submit without it",
  selected: "the option is selected",
};

export const falseOnABooleanAttribute = {
  id: "false-on-a-boolean-attribute",

  report: {
    severity: "error",
    reportedWhen:
      'a boolean attribute is written `"false"`, which turns it ON because the parser reads only that it is there',
    alsoReportedAs: "RMD029",
    heading: (found) => `${found.length} boolean attribute(s) turned ON by a string that says off:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.tag} ${issue.attribute}="false"> — and the result is that ${issue.outcome}.`,
    ],
    advice:
      "A boolean attribute is true whenever it is PRESENT, whatever it says: the parser never reads\n" +
      'the value. So the string "false" turns it ON, which is the opposite of what the line says.\n\n' +
      "Pass the boolean itself:\n\n" +
      "```tsx\n" +
      "<button disabled={false}>Save</button>\n" +
      "<input required={someCondition} />\n" +
      "```\n\n" +
      "A `false` removes the attribute, and removing it is the only way HTML has of turning one\n" +
      "off.\n\n" +
      'This does not apply to `aria-*`, which are enumerated STRINGS: `aria-hidden="false"` really\n' +
      'does mean "not hidden", and there the empty and absent forms mean a third thing again.\n\n' +
      "The framework reports it at runtime as `RMD029` — but only for markup that renders. This is\n" +
      "the same fault found in a branch nobody has opened.\n\n",
  },

  /**
   * The order guard is taken, because this report names an OUTCOME.
   *
   * `<input required="false" {...rest} />` may end up with a `required` the spread decided, and
   * then "the form will not submit without it" is a sentence about an element that does not exist.
   * The misspelling is still in the source either way — but the family's line is what the rule is
   * ABOUT, and this one is about what the element WILL BE.
   */
  evenWhenSpreading: true,

  read(_element, { tag, attributes, attr, overwritable }) {
    if (tag === undefined) return [];

    const found: FalseOnABooleanAttributeIssue[] = [];

    for (const written of attributes) {
      const attribute = written.name.toLowerCase();
      if (!BOOLEAN_ATTRIBUTES.has(attribute)) continue;

      /**
       * `attr` answers only for STRINGS, which is exactly the line this rule needs.
       *
       * `disabled={false}` is the boolean and is correct, so it must not be read as the word — and
       * it is not, because a boolean is not a string. `disabled={NO}` with `const NO = "false"` IS
       * the word, one name away, and reaches the element identically.
       */
      if (attr(written.name)?.trim().toLowerCase() !== "false") continue;

      // A spread AFTER it may replace the value or take the attribute away entirely.
      if (overwritable(written.name)) continue;

      /**
       * The VALUE is replaced, not the attribute, and the difference is the whole of the fix.
       *
       * `disabled="false"` becomes `disabled={false}`, which is the boolean — and a `false` boolean
       * is what removes the attribute, which is the only way HTML has of turning one off. Deleting
       * the attribute instead would reach the same DOM and lose the author's intent: they wrote a
       * value that says off, and `{false}` is that value spelled so it works.
       *
       * Only a literal is carried. `disabled={NO}` with `const NO = "false"` is the same fault, and
       * its answer is somewhere else in the file — this cannot know whether that name is used
       * anywhere it would still have to be a string.
       */
      const value = written.at;
      const literal =
        ts.isJsxAttribute(value) && value.initializer !== undefined && ts.isStringLiteral(value.initializer)
          ? value.initializer
          : undefined;
      const edit =
        literal === undefined
          ? undefined
          : {
              from: literal.getStart(),
              to: literal.getEnd(),
              text: "{false}",
              says: `\`${attribute}="false"\` → \`${attribute}={false}\``,
            };

      found.push({
        tag,
        attribute,
        outcome: OUTCOME[attribute] ?? "the attribute is on",
        ...(edit ? { edit } : {}),
        ...positionOf(written.at),
      });
    }

    return found;
  },
} as const satisfies ElementRule<FalseOnABooleanAttributeIssue>;
