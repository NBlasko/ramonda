import { diagnose } from "./diagnostics";
import { BOOLEAN_ATTRIBUTES } from "../helpers/constants";

/**
 * DEV-only: `disabled="false"` and its family. RMD029.
 *
 * ## What actually happens
 *
 * A boolean attribute is true when it is PRESENT, whatever it says. The HTML parser does not read
 * the value, so `disabled="false"` disables the control and `hidden="false"` hides the element —
 * the opposite of what was written. Measured:
 *
 * ```
 *   disabled={false}     → attribute absent,  element enabled   ✓
 *   disabled={"false"}   → attribute present, element DISABLED  ✗
 * ```
 *
 * The framework already does the right thing for a real boolean: `false` removes the attribute
 * (`isInvisibleOnScreen` in `core/Attribute.ts`). What it cannot do is guess that the STRING
 * `"false"` was meant as a boolean.
 *
 * ## Why this is not fixed instead of reported
 *
 * Because "fix" would mean disagreeing with HTML. `<input disabled="false">` in a hand-written page
 * is disabled, in every browser, by the spec. A framework that quietly read the string and decided
 * otherwise would make its JSX mean something different from the markup it produces — and the
 * difference would show up as a hydration mismatch, or as markup that behaves one way rendered by
 * us and another way when copied into a page.
 *
 * So the attribute is set exactly as asked, and this says what the result will be.
 *
 * ## Only the string `"false"`
 *
 * Certain, and that is the bar. `"no"`, `"off"` and `"0"` are probably mistakes too, and probably is
 * not enough: an attribute whose value is data — a `data-*` flag, an ARIA state — legitimately
 * carries those words, and a diagnostic that fires on correct code teaches people to skip the
 * category. `"false"` on a genuinely boolean attribute has no reading under which it was intended.
 */

/** What the element will do, per attribute, so the report is about the outcome rather than the rule. */
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

/**
 * Checks one attribute as it is applied.
 *
 * Two comparisons on the hot path in a development build, and only for a value that is a string —
 * a real boolean, a number and everything else return on the first test.
 */
export function checkBooleanAttribute(tag: string, name: string, value: unknown): void {
  if (value !== "false") return;

  const attribute = name.toLowerCase();
  if (!BOOLEAN_ATTRIBUTES.has(attribute)) return;

  const outcome = OUTCOME[attribute] ?? "the attribute is on";

  diagnose(
    "RMD029",
    `${tag}:${attribute}`,
    `<${tag.toLowerCase()} ${attribute}="false"> — and the result is that ${outcome}.\n` +
      `A boolean attribute is true whenever it is PRESENT, whatever it says: the parser never reads the value. So the string "false" turns it ON, which is the opposite of what the line says.\n\n` +
      `Pass the boolean itself — \`${attribute}={false}\`, or \`${attribute}={someCondition}\`. A \`false\` removes the attribute, which is what makes it off.`,
  );
}
