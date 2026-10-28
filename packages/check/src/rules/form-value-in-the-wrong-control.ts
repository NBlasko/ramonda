import ts from "typescript";
import { positionOf } from "../syntax";
import { coreElementTag } from "./coreElements";
import { openingOf, tagOf } from "./element";
import { unwrap } from "./follow-value";
import { attributeLiterals, typeAttributeOf } from "./formTable";
import type { ElementContext, ElementRule } from "./rule";

/**
 * A number or a day a `@ramonda/form` field shows, in a control that does not turn it back into one.
 *
 * A field writes back what its control produced by the control's own `type`: `type="number"` hands
 * back a number, `type="date"` a day, and every other control — a text `<input>`, a `TextArea`, a
 * `Select` — hands back its text. So a number field written without `type="number"` fills the form
 * with text on the first keystroke, and the schema reports a value the reader never typed wrong.
 * `bind` used to write the `type` itself; the form's fields are written attribute by attribute now,
 * and this is the attribute nothing else asks for.
 *
 * Read off the TYPE of the control's `value`: the form marks the number and the day its fields show
 * (`FormNumber`, `FormDay`), so a number the app holds itself — `value={this.count}` — is not asked
 * about. The one rule here that reads types, and the reason the program carries a lib — see
 * `createProgram` in `analyze.ts`.
 *
 * A `type="hidden"` input keeps it too: it posts the value with the form and nobody edits it.
 *
 * **What it will not let pass in silence.** A `type` it cannot read — `type={kind}` — around a form's
 * number, and an `.inputValue` whose type it cannot read at all: either may be right, and neither can
 * be shown to be. A spreading element is not asked, as in every element rule: the spread may carry
 * the `type`.
 */
export interface FormValueInTheWrongControlIssue {
  /**
   * `number` or `day` — the form's value in a control of another kind;
   * `type-unread` — in an `<input>` whose `type` cannot be read;
   * `unreadable` — an `.inputValue` whose type cannot be read.
   */
  kind: "number" | "day" | "type-unread" | "unreadable";
  /** The control as written: `<input type="text">`, `<input>`, `<TextArea>`, `<Select>`. */
  control: string;
  file: string;
  line: number;
  column: number;
}

/** The `type` a value of this kind belongs in. */
const WANTED = { number: "number", day: "date" } as const;

/**
 * Whether an `<input>` of this `type` keeps the value as it is: one that turns it back — a slider,
 * `type="range"`, is a number control too — or a `hidden` one, which nobody edits and so hands
 * nothing back. Without regard to case, as HTML reads
 * the attribute — `type="Number"` is a number control, and `element.type`, which the form reads, says
 * `"number"`.
 */
const keeps = (type: string, kind: keyof typeof WANTED): boolean => {
  const read = type.toLowerCase();
  return read === WANTED[kind] || read === "hidden" || (kind === "number" && read === "range");
};

export const formValueInTheWrongControl = {
  id: "form-value-in-the-wrong-control",

  report: {
    severity: "error",
    reportedWhen:
      'a number a `@ramonda/form` field shows sits in a control that is not `<input type="number">` or ' +
      '`type="range"`, a day ' +
      'in one that is not `type="date"` (a `type="hidden"` one keeps either), or either in an `<input>` ' +
      "whose `type` cannot be read — or a " +
      "field's `.inputValue` has a type the check cannot read",
    heading: (found) => `${found.length} form value(s) in a control that will not hand them back:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      issue.kind === "number"
        ? `    a number field's value in ${issue.control}, which hands back text — write \`<input type="number">\`.`
        : issue.kind === "day"
          ? `    a date field's value in ${issue.control}, which hands back text — write \`<input type="date">\`.`
          : issue.kind === "type-unread"
            ? `    a number's or a day's value in ${issue.control}, whose \`type\` cannot be read — write it as a literal.`
            : `    \`.inputValue\` in ${issue.control} has a type the check cannot read, so what it belongs in cannot be shown.`,
    ],
    advice:
      'A form field writes back what its control produced by the control\'s own `type`: `type="number"`\n' +
      'hands back a number, `type="date"` a day, and every other control hands back its text. A number\n' +
      "field without its `type` fills the form with text on the first keystroke, and the schema reports a\n" +
      "value the reader never typed wrong.\n\n" +
      "```tsx\n" +
      '<input type="number" name={age.name} value={age.inputValue} oninput={age.oninput} />\n' +
      '<input type="date" name={born.name} value={born.inputValue} oninput={born.oninput} />\n' +
      "```\n\n" +
      "`RMF005` reports the same in a running page, once the field holds a value.\n\n",
  },

  read(element, { tag, resolve }: ElementContext) {
    const opening = openingOf(element);
    const field = tagOf(element) ?? coreElementTag(opening.tagName, resolve) ?? tag;
    if (field !== "input" && field !== "select" && field !== "textarea") return [];
    const written = opening.attributes.properties.find(
      (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === "value",
    );
    const expression =
      written?.initializer !== undefined && ts.isJsxExpression(written.initializer)
        ? written.initializer.expression
        : undefined;
    if (expression === undefined) return [];
    const kind = resolve.formValue(expression);
    if (kind === "other") return [];

    const typeAttribute = field === "input" ? typeAttributeOf(element) : undefined;
    const types = typeAttribute === undefined ? [] : attributeLiterals(typeAttribute, resolve);
    const control =
      field === "select"
        ? "<Select>"
        : field === "textarea"
          ? "<TextArea>"
          : typeAttribute === undefined
            ? "<input>"
            : types === undefined
              ? `<input ${typeAttribute.getText()}>`
              : `<input type="${types.join(" | ")}">`;
    const at = positionOf(opening);

    if (kind === "unread") {
      const value = unwrap(expression);
      const asksTheForm = ts.isPropertyAccessExpression(value) && value.name.text === "inputValue";
      return asksTheForm ? [{ kind: "unreadable" as const, control, ...at }] : [];
    }
    if (field === "input" && typeAttribute !== undefined && types === undefined) {
      return [{ kind: "type-unread" as const, control, ...at }];
    }
    if (field === "input" && types !== undefined && types.length > 0 && types.every((t) => keeps(t, kind))) {
      return [];
    }
    return [{ kind, control, ...at }];
  },
} as const satisfies ElementRule<FormValueInTheWrongControlIssue>;
