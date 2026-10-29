import ts from "typescript";
import { positionOf } from "../syntax";
import { coreElementTag } from "./coreElements";
import { openingOf, tagOf } from "./element";
import { unwrap } from "./follow-value";
import { UNEDITED_INPUT_TYPES } from "@ramonda/dom-facts";
import { attributeLiterals, typeAttributeOf } from "./formTable";
import type { ElementContext, ElementRule } from "./rule";

/**
 * A value a `@ramonda/form` field shows, in a control that hands back another kind.
 *
 * A field writes back what its control produced by the control's own `type`: `type="number"` and
 * `type="range"` hand back a number, `type="checkbox"` true or false, and every other control — a text
 * `<input>`, a `TextArea`, a `Select` — its text. `type="date"` serves a `Date` and a date written as
 * text, and hands each its own: a day to a `Date`, text to text. So a number
 * field written without `type="number"` fills the form with text on the first keystroke, a text field in
 * a slider fills it with a number, and the schema reports a value the reader never typed wrong.
 *
 * Read off the TYPE of the control's `value`: the form marks the number, the day and the text its fields
 * show (`FormNumber`, `FormDay`, `FormText`), so a value the app holds itself — `value={this.count}` — is
 * not asked about. The control's `type` is read as written, or off its type where it is an expression:
 * `type={this.props.type}` typed `"text" | "email"` is read as those two.
 *
 * An input nobody edits — `hidden`, `submit`, `button` and the rest of `UNEDITED_INPUT_TYPES` — keeps any
 * value: it hands nothing back.
 *
 * A date written as text in `type="date"` has to be text from the start: the input tells it from a
 * `Date` by the text it holds, and hands a field holding nothing a day. So a field that may hold
 * nothing — `born?: string`, its text marked `FormOptional` — is reported there; one typed `string`,
 * with `""` for no date, is not.
 *
 * **What it will not let pass in silence.** A `type` it cannot read — `type={kind}` typed `string` — and an
 * `.inputValue` whose type it cannot read at all: either may be right, and neither can be shown to be. A
 * spreading element is not asked, as in every element rule: the spread may carry the `type`.
 */
export interface FormValueInTheWrongControlIssue {
  /**
   * `number`, `day` or `text` — the form's value in a control that hands back another kind;
   * `optional-date-text` — a date written as text, in `type="date"`, whose field may hold nothing: it takes
   * a day on its first pick;
   * `type-unread` — in an `<input>` whose `type` cannot be read;
   * `unreadable` — an `.inputValue` whose type cannot be read.
   */
  kind: "number" | "day" | "text" | "optional-date-text" | "type-unread" | "unreadable";
  /** The control as written: `<input type="text">`, `<input>`, `<TextArea>`, `<Select>`. */
  control: string;
  file: string;
  line: number;
  column: number;
}

/** What a control of this `type` hands back, as the form reads it; any `type` not here hands back text. */
const HANDS_BACK: ReadonlyMap<string, "number" | "day" | "boolean"> = new Map([
  ["number", "number"],
  ["range", "number"],
  ["date", "day"],
  ["checkbox", "boolean"],
]);

/**
 * Whether a control of this `type` keeps a value of this kind: one that hands that kind back, or one
 * nobody edits, which hands nothing back. Read without regard to case, as HTML reads the attribute —
 * `type="Number"` is a number control, and `element.type`, which the form reads, says `"number"`. A
 * `Select`, a `TextArea` and an `<input>` with no `type` hand back text.
 */
const keeps = (type: string, kind: "number" | "day" | "text"): boolean => {
  const read = type.toLowerCase();
  // A date input hands text back to a field that holds text — a date written as text, `""` at the start.
  if (read === "date" && kind === "text") return true;
  return UNEDITED_INPUT_TYPES.has(read) || (HANDS_BACK.get(read) ?? "text") === kind;
};

export const formValueInTheWrongControl = {
  id: "form-value-in-the-wrong-control",

  report: {
    severity: "error",
    reportedWhen:
      'a number a `@ramonda/form` field shows sits in a control that is not `<input type="number">` or ' +
      '`type="range"`, a day in one that is not `type="date"`, or text in a number control or a checkbox ' +
      '(an input nobody edits, such as `type="hidden"`, keeps any), or any of them in an `<input>` whose ' +
      "`type` cannot be read — or a field's `.inputValue` has a type the check cannot read",
    heading: (found) => `${found.length} form value(s) in a control that will not hand them back:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      issue.kind === "number"
        ? `    a number field's value in ${issue.control}, which does not hand back a number — write \`<input type="number">\`.`
        : issue.kind === "day"
          ? `    a date field's value in ${issue.control}, which does not hand back a day — write \`<input type="date">\`.`
          : issue.kind === "optional-date-text"
            ? `    a date written as text in ${issue.control}, whose field may hold nothing — and a date input hands a field holding nothing a day: type it \`string\`, with \`""\` for no date.`
            : issue.kind === "text"
              ? `    a text field's value in ${issue.control}, which hands back something other than text — write it in a control that hands back text.`
              : issue.kind === "type-unread"
                ? `    a form field's value in ${issue.control}, whose \`type\` cannot be read — write it as a literal.`
                : `    \`.inputValue\` in ${issue.control} has a type the check cannot read, so what it belongs in cannot be shown.`,
    ],
    advice:
      'A form field writes back what its control produced by the control\'s own `type`: `type="number"`\n' +
      'and `type="range"` hand back a number — whatever the field held, as an empty field could be waiting\n' +
      'for a number or text alike — and `type="date"` a day to a `Date` and text to a date written as text.\n' +
      "Every other control hands back its text. A number field without its `type` fills the form with text\n" +
      "on the first keystroke, a text field in a slider with a number, and the schema reports a value the\n" +
      "reader never typed wrong.\n\n" +
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
    const read = resolve.formValue(expression);
    if (read === "other") return [];
    const kind = read === "optional-text" ? "text" : read;

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
    // What the control hands back, by the `type` it may have — none, on a `Select`, a `TextArea` or an
    // `<input>` without one, is text.
    const handsBack = field === "input" && typeAttribute !== undefined ? types : ["text"];
    if (handsBack === undefined) return [{ kind: "type-unread" as const, control, ...at }];
    if (handsBack.length === 0 || !handsBack.every((type) => keeps(type, kind))) return [{ kind, control, ...at }];
    // A date input tells a date written as text from a `Date` by the text the field holds: one that may
    // hold nothing takes a day on its first pick.
    const dated = handsBack.some((type) => type.toLowerCase() === "date");
    return read === "optional-text" && dated ? [{ kind: "optional-date-text" as const, control, ...at }] : [];
  },
} as const satisfies ElementRule<FormValueInTheWrongControlIssue>;
