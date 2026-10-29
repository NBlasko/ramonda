import ts from "typescript";
import { positionOf } from "../syntax";
import { coreElementTag } from "./coreElements";
import { openingOf, tagOf } from "./element";
import { unwrap } from "./follow-value";
import { UNEDITED_INPUT_TYPES } from "@ramonda/dom-facts";
import { typeAttributeOf, typeLiterals } from "./formTable";
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
 * **What it will not let pass in silence.** A `type` it cannot read — `type={kind}` typed `string` — and an
 * `.inputValue` whose type it cannot read at all: either may be right, and neither can be shown to be. A
 * spreading element is not asked, as in every element rule: the spread may carry the `type`.
 */
export interface FormValueInTheWrongControlIssue {
  /**
   * `number`, `day` or `text` — the form's value in a control that hands back another kind;
   * `no-value` — the `.inputValue` of a field whose value no control's `value` shows: a boolean, which a
   * box shows as `checked`, or a file;
   * `type-unread` — in an `<input>` whose `type` cannot be read;
   * `unreadable` — an `.inputValue` whose type cannot be read.
   */
  kind: "number" | "day" | "text" | "no-value" | "type-unread" | "unreadable";
  /** The control as written: `<input type="text">`, `<input>`, `<TextArea>`, `<Select>`. */
  control: string;
  file: string;
  line: number;
  column: number;
}

type Kind = "number" | "day" | "text";

/**
 * What a control of this `type` hands back, as the form reads it — a date input serves two kinds, a day
 * to a `Date` and text to a date written as text, and a checkbox none of them, true or false. Any `type`
 * not here hands back text.
 */
const HANDS_BACK: ReadonlyMap<string, ReadonlySet<Kind>> = new Map([
  ["number", new Set<Kind>(["number"])],
  ["range", new Set<Kind>(["number"])],
  ["date", new Set<Kind>(["day", "text"])],
  ["checkbox", new Set<Kind>()],
  // A file input's `value` cannot be written: core writing one throws.
  ["file", new Set<Kind>()],
]);

/** Inputs nobody edits, which hand nothing back — but a file input, whose `value` cannot be written. */
const UNEDITED = new Set([...UNEDITED_INPUT_TYPES].filter((type) => type !== "file"));

/**
 * Whether a control of this `type` keeps a value of this kind: one that hands that kind back, or one
 * nobody edits, which hands nothing back. Read without regard to case, as HTML reads the attribute —
 * `type="Number"` is a number control, and `element.type`, which the form reads, says `"number"`. A
 * `Select`, a `TextArea` and an `<input>` with no `type` hand back text.
 */
const keeps = (type: string, kind: Kind): boolean => {
  const read = type.toLowerCase();
  return UNEDITED.has(read) || (HANDS_BACK.get(read)?.has(kind) ?? kind === "text");
};

export const formValueInTheWrongControl = {
  id: "form-value-in-the-wrong-control",

  report: {
    severity: "error",
    reportedWhen:
      'a number a `@ramonda/form` field shows sits in a control that is not `<input type="number">` or ' +
      '`type="range"`, a day in one that is not `type="date"`, or text in a number control or a checkbox ' +
      '(an input nobody edits, such as `type="hidden"`, keeps any), or any of them in an `<input>` whose ' +
      "`type` cannot be read — or a field's `.inputValue` has a type the check cannot read, or is one no " +
      "control's `value` shows (a boolean, which a box shows as `checked`)",
    heading: (found) => `${found.length} form value(s) in a control that will not hand them back:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      issue.kind === "number"
        ? `    a number field's value in ${issue.control}, which does not hand back a number — write \`<input type="number">\`.`
        : issue.kind === "day"
          ? `    a date field's value in ${issue.control}, which does not hand back a day — write \`<input type="date">\`.`
          : issue.kind === "no-value"
            ? `    \`.inputValue\` of a field no control's \`value\` shows, in ${issue.control} — a box is \`<input type="checkbox" checked={field.value === true}>\`.`
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
    const kind = resolve.formValue(expression);
    if (kind === "other") return [];

    const typeAttribute = field === "input" ? typeAttributeOf(element) : undefined;
    const types = typeAttribute === undefined ? [] : typeLiterals(typeAttribute, resolve);
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

    const value = unwrap(expression);
    const asksTheForm = ts.isPropertyAccessExpression(value) && value.name.text === "inputValue";
    if (kind === "unread") return asksTheForm ? [{ kind: "unreadable" as const, control, ...at }] : [];
    if (kind === "none") return asksTheForm ? [{ kind: "no-value" as const, control, ...at }] : [];
    // What the control hands back, by the `type` it may have — none, on a `Select`, a `TextArea` or an
    // `<input>` without one, is text.
    const handsBack = field === "input" && typeAttribute !== undefined ? types : ["text"];
    if (handsBack === undefined) return [{ kind: "type-unread" as const, control, ...at }];
    return handsBack.length > 0 && handsBack.every((type) => keeps(type, kind)) ? [] : [{ kind, control, ...at }];
  },
} as const satisfies ElementRule<FormValueInTheWrongControlIssue>;
