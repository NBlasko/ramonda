import ts from "typescript";
import { positionOf } from "../syntax";
import { coreElementTag } from "./coreElements";
import { openingOf, tagOf } from "./element";
import { enclosingElement } from "./html";
import type { ElementContext, ElementRule, JsxElementLike, TextEdit } from "./rule";

/**
 * `<option selected>` inside a `<Select>`, which overwrites it on every render.
 *
 * `Select` decides the choice from its `value`, and it does so by walking EVERY option and setting
 * each one — `option.selected = option.value === value`, on and off, for all of them. So an option
 * that asked to be chosen is turned off again a moment later, and one that asked for nothing may be
 * turned on. The attribute is not fighting `value` and losing sometimes; it does nothing at all.
 *
 * ## Why the component exists, and why this is the leftover
 *
 * `<select>` is refused by core's own types because the tag could not be written correctly: HTML
 * settles competing `selected` claims by keeping the LAST one, and gives a select with no claim its
 * first option — so the same markup meant different things depending on the order the options
 * reached it, which is not an order anybody writes. `<Select value={x}>` settles it once the
 * options exist.
 *
 * The option's own attribute stayed writable, and it is the one line that still looks like it
 * chooses. This is the fault the refusal could not reach.
 *
 * ## What it will not claim
 *
 * `selected={false}` says the opposite, and nothing is overwritten that was not already off.
 * `{options.map(…)}` is children this cannot read. A spread may carry the attribute or replace it.
 * And an `<option>` with no `<Select>` above it is not this report: nothing is deciding for it, so
 * whatever it does is between it and whoever renders it.
 */
export interface OptionThatCannotChooseIssue {
  /** The `value` written on the option, when there is one to print. */
  value?: string;
  /** Removing the attribute, which is the whole fix — see {@link TextEdit}. */
  edit?: TextEdit;
  file: string;
  line: number;
  column: number;
}

/**
 * Whether a `<Select>` encloses this option, at any depth.
 *
 * `<optgroup>` is the ordinary reason for the depth — a grouped select puts its options one level
 * further in — and the walk reads each ancestor's tag the way every rule does now, so the
 * `<Select>` COMPONENT answers "select" exactly as the refused tag would have.
 */
function insideASelect(element: JsxElementLike, resolve: ElementContext["resolve"]): boolean {
  let at = enclosingElement(element);
  while (at !== undefined) {
    const tag = tagOf(at) ?? coreElementTag(openingOf(at).tagName, resolve);
    if (tag === "select") return true;
    at = enclosingElement(at);
  }
  return false;
}

export const optionThatCannotChoose = {
  id: "option-that-cannot-choose",

  report: {
    severity: "warn",
    reportedWhen: "`selected` is written on an `<option>` inside a `<Select>`, which sets it from `value` instead",
    heading: (found) => `${found.length} \`<option selected>\` that decide(s) nothing:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      issue.value === undefined
        ? "    `selected` here is overwritten — `Select` sets it on every option from its `value`."
        : `    \`selected\` on \`value="${issue.value}"\` is overwritten — \`Select\` sets it from its own \`value\`.`,
    ],
    advice:
      "`Select` decides the choice, and it does it by walking EVERY option and setting each one on\n" +
      "or off from its `value`. An option that asked to be chosen is turned off again a moment\n" +
      "later. The attribute is not competing with `value` — it does nothing.\n\n" +
      "Say which one is chosen where the component already asks:\n\n" +
      "```tsx\n" +
      '<Select value={chosen} aria-label="Size">\n' +
      '  <option value="s">Small</option>\n' +
      '  <option value="m">Medium</option>\n' +
      "</Select>\n" +
      "```\n\n" +
      "For an initial choice, that is what the state behind `value` starts as. For several, `value`\n" +
      "takes an array and the select is `multiple`.\n\n" +
      "This is the fault the refused `<select>` tag could not reach. The tag is refused because HTML\n" +
      "settles competing `selected` claims by keeping the LAST one, and gives a select with no claim\n" +
      "its first option — so the same markup meant different things depending on the order the\n" +
      "options reached it, and that is not an order anybody writes. `<Select value={x}>` settles it\n" +
      "once they all exist; the option's own attribute is the one line that still looks like it\n" +
      "chooses.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  /**
   * No `evenWhenSpreading`: a spread on the option may be carrying `selected` or replacing it, so
   * the family's default — not asking about a spreading element at all — is the guard this wants.
   */

  read(element, { tag, truth, attr, resolve }: ElementContext) {
    if (tag !== "option") return [];

    // Only a claim to BE selected is overwritten. `selected={false}` says the opposite, and
    // anything unreadable is not a claim this can read.
    if (truth("selected") !== true) return [];

    if (!insideASelect(element, resolve)) return [];

    const value = attr("value");

    /**
     * The fix is DELETION, and it is the whole of it: `Select` already decides from `value`, so
     * taking the attribute away leaves the page doing exactly what it did — correctly this time,
     * and saying so.
     *
     * The span runs from the whitespace BEFORE the attribute to its end, so removing it does not
     * leave a double space behind. Nothing else on the line moves.
     */
    const written = openingOf(element).attributes.properties.find(
      (property) => ts.isJsxAttribute(property) && property.name.getText().toLowerCase() === "selected",
    );
    const edit =
      written === undefined
        ? undefined
        : { from: written.getFullStart(), to: written.getEnd(), text: "", says: "remove `selected`" };

    return [
      {
        ...(value === undefined ? {} : { value }),
        ...(edit ? { edit } : {}),
        ...positionOf(openingOf(element)),
      },
    ];
  },
} as const satisfies ElementRule<OptionThatCannotChooseIssue>;
