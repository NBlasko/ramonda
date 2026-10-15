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

/**
 * Whether an element around this one listens for an event that moves the model in time — `<form
 * oninput>`. For a `TextArea` only `input` does: an ancestor's `change` comes on blur, after every
 * keystroke has been undone.
 */
function heardAbove(element: JsxElementLike, events: readonly string[]): boolean {
  for (let at = enclosingElement(element); at !== undefined; at = enclosingElement(at)) {
    const heard = eventsOf(at);
    if (events.some((event) => heard.has(event))) return true;
  }
  return false;
}

/**
 * Whether an attribute is ON as written: bare (`readonly`), or `={true}`. `readOnly={this.viewing}` may
 * be off, and a field that may take input is asked like any other.
 */
function switchedOn(element: JsxElementLike, names: readonly string[]): boolean {
  return openingOf(element).attributes.properties.some((attribute) => {
    if (!ts.isJsxAttribute(attribute) || !names.includes(attribute.name.getText())) return false;
    const value = attribute.initializer;
    if (value === undefined) return true;
    return ts.isJsxExpression(value) && value.expression?.kind === ts.SyntaxKind.TrueKeyword;
  });
}

/**
 * Whether the `value` is handed in from outside — `this.props.text`. The handler that moves it is then
 * the parent's business, and may be an `oninput` on an element of the parent's own render, which this
 * rule, reading one component, cannot see.
 */
function fromProps(element: JsxElementLike): boolean {
  const value = openingOf(element).attributes.properties.find(
    (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText() === "value",
  );
  const written = value !== undefined && ts.isJsxAttribute(value) ? value.initializer?.getText() : undefined;
  return written !== undefined && /\bprops\b/.test(written);
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
 * a rule that cannot see it would report every bound field; a field written `readonly` or `disabled`
 * (bare or `={true}`), which takes no input to undo; a field with a handler on an element around it,
 * `<form oninput>`, which core waits for before it settles; and a field whose `value` comes from
 * `props`, whose handler may sit in the parent's render.
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

    const moving: readonly string[] = tag === "textarea" ? ["input"] : ["input", "change"];
    if (
      switchedOn(element, ["readonly", "readOnly", "disabled"]) ||
      heardAbove(element, moving) ||
      fromProps(element)
    ) {
      return [];
    }
    const events = eventsOf(element);
    if (!events.has("input") && !events.has("change")) return [{ component, kind: "no-handler", ...at }];
    if (tag === "textarea" && !events.has("input")) return [{ component, kind: "held-between-keystrokes", ...at }];
    return [];
  },
} as const satisfies ElementRule<FieldTheUserCannotChangeIssue>;
