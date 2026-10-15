import ts from "typescript";
import { positionOf } from "../syntax";
import { coreElementTag } from "./coreElements";
import { openingOf } from "./element";
import { eventTypeOf } from "./events";
import { enclosingElement } from "./html";
import type { ElementRule, JsxElementLike } from "./rule";

export interface FieldTheUserCannotChangeIssue {
  component: "Select" | "TextArea";
  /**
   * `no-handler` — a `value` and nothing that could move it; `held-between-keystrokes` — a
   * `TextArea` whose `value` moves only `onchange`, on blur; `both` — `value` beside `defaultValue`.
   */
  kind: "no-handler" | "held-between-keystrokes" | "both";
  file: string;
  line: number;
  column: number;
}

/** The names an element is written with. */
function namesOf(element: JsxElementLike): string[] {
  return openingOf(element)
    .attributes.properties.filter(ts.isJsxAttribute)
    .map((attribute) => attribute.name.getText());
}

/** The events an element has a handler for, in any spelling. */
function eventsOf(element: JsxElementLike): Set<string | undefined> {
  return new Set(namesOf(element).map((name) => eventTypeOf(name)?.type));
}

/** Whether an element around this one listens for the field's input — a `<form oninput>`. */
function heardAbove(element: JsxElementLike): boolean {
  for (let at = enclosingElement(element); at !== undefined; at = enclosingElement(at)) {
    const events = eventsOf(at);
    if (events.has("input") || events.has("change")) return true;
  }
  return false;
}

/**
 * A `Select` or `TextArea` given a `value` the page can never change.
 *
 * A field with `value` is the MODEL's: after every input, once the event is over, core settles it
 * from `value` again — so a handler that does not move the model undoes the input, and a field with
 * no handler cannot be changed at all. That is what makes `value` mean one thing; it is also what
 * turns the habit of writing `value` for where a field STARTS into a field nobody can type in.
 *
 * Three shapes, all provable from the source:
 *
 * - **`value` and no `oninput` / `onchange`** — nothing can move the model, so every input is undone.
 * - **A `TextArea` with `value` and only `onchange`** — `change` comes on blur, so every keystroke is
 *   undone before it: the user cannot type. A `Select` is not reported for this: its `change` comes
 *   with the pick itself.
 * - **`value` beside `defaultValue`** — `value` wins and `defaultValue` says nothing.
 *
 * The answer to the first two is either a handler that moves the model, or `defaultValue` for a field
 * whose text is read when the form is sent.
 *
 * Not reported: an element with a spread — `{...bind}` from `@ramonda/form` carries the handler, and
 * a rule that cannot see it would report every bound field; a `readonly` or `disabled` field, which
 * takes no input to undo — showing a value the user cannot edit is what it is for; and a field with a
 * handler on an element around it, `<form oninput>`, which core waits for before it settles.
 */
export const fieldTheUserCannotChange = {
  id: "field-the-user-cannot-change",

  report: {
    severity: "error",
    reportedWhen:
      "a `Select` or `TextArea` has a `value` that nothing moves — no handler, or a `TextArea` with only " +
      "`onchange` — so every input is undone; or `value` sits beside `defaultValue`",
    heading: (found) => `${found.length} field(s) the user cannot change:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      issue.kind === "both"
        ? `    <${issue.component}> has \`value\` and \`defaultValue\` — \`value\` wins, and \`defaultValue\` says nothing.`
        : issue.kind === "held-between-keystrokes"
          ? `    <${issue.component} value> moves only \`onchange\`, on blur — every keystroke is undone before it.`
          : `    <${issue.component} value> has no handler — the model never moves, so every input is undone.`,
    ],
    advice:
      "A field with `value` shows what the model holds: after every input, once the event is over, it\n" +
      "is settled from `value` again. A handler that moves the model keeps what the user did; one that\n" +
      "does not, or none, undoes it.\n\n" +
      "Hold it in the model, and move the model on every input:\n\n" +
      "```tsx\n" +
      '<TextArea aria-label="Draft" value={this.draft} oninput={this.type} />\n' +
      "```\n\n" +
      "Or, for a field whose text is read when the form is sent, say where it STARTS:\n\n" +
      "```tsx\n" +
      '<TextArea aria-label="Notes" name="notes" defaultValue={this.saved} />\n' +
      "```\n\n" +
      "A `TextArea` saved on blur is the second form: `onchange` comes when it loses focus, and with\n" +
      "`value` every keystroke before it is undone.\n\n",
  },

  read(element, { resolve }) {
    const opening = openingOf(element);
    const tag = coreElementTag(opening.tagName, resolve);
    if (tag !== "select" && tag !== "textarea") return [];

    const names = namesOf(element);
    if (!names.includes("value")) return [];

    const component = tag === "select" ? "Select" : "TextArea";
    const at = positionOf(opening);
    if (names.includes("defaultValue")) return [{ component, kind: "both", ...at }];

    if (names.some((name) => /^(readonly|readOnly|disabled)$/.test(name)) || heardAbove(element)) return [];
    const events = eventsOf(element);
    if (!events.has("input") && !events.has("change")) return [{ component, kind: "no-handler", ...at }];
    if (tag === "textarea" && !events.has("input")) return [{ component, kind: "held-between-keystrokes", ...at }];
    return [];
  },
} as const satisfies ElementRule<FieldTheUserCannotChangeIssue>;
