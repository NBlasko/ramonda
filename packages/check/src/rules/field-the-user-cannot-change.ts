import ts from "typescript";
import { positionOf } from "../syntax";
import { coreElementTag } from "./coreElements";
import { openingOf, writtenAsNothing } from "./element";
import { follow, unwrap, type Looking } from "./follow-value";
import type { ElementContext, ElementRule, WrittenAttribute } from "./rule";
import { kindOfLiterals, propRead, typeAttributeOf, typeLiterals } from "./formTable";

export interface FieldTheUserCannotChangeIssue {
  component: "Select" | "TextArea" | "input";
  /**
   * `no-handler` — a controlled field with no handler of its own that writes the model;
   * `held-between-keystrokes` — a text field whose only handler is `onchange`, on blur;
   * `both` — `value` beside `defaultValue`, or `checked` beside `defaultChecked`;
   * `literal` — a text field's `value` written as itself, `value=""`, which no handler can move;
   * `unknown-spread` — a spread on a controlled field that the source cannot say carries a handler;
   * `handler-may-be-missing` — the field's handler is a prop declared optional, `oninput?:`;
   * `pick-through-click` — a box picked through `onclick`, which a pick sent without a click never reaches;
   * `change-after-its-input` — a date, time, color or range with only `onchange`, after its `input`.
   */
  kind:
    | "no-handler"
    | "held-between-keystrokes"
    | "both"
    | "literal"
    | "unknown-spread"
    | "handler-may-be-missing"
    | "pick-through-click"
    | "change-after-its-input";
  file: string;
  line: number;
  column: number;
}

/** A value read down to a literal — a string, a number (`-1` included), a plain template — and no further. */
const LITERAL: Looking<true> = {
  leaf: (expression) => {
    if (ts.isStringLiteral(expression) || ts.isNumericLiteral(expression)) return true;
    if (ts.isNoSubstitutionTemplateLiteral(expression)) return true;
    const negative =
      ts.isPrefixUnaryExpression(expression) &&
      expression.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(unwrap(expression.operand));
    return negative ? true : undefined;
  },
  throughModuleScope: true,
  // One arm says nothing about the other, and a call or a `let` may hand back something else.
  throughBranches: false,
  throughCalls: false,
  throughMutableBindings: false,
  throughMemoizedCalls: false,
};

/** Whether a `value` is a literal, or a `const` holding one — read from nothing the page can move. */
function writtenAsItself(value: WrittenAttribute, resolve: ElementContext["resolve"]): boolean {
  return value.value !== undefined && follow(value.value, resolve, LITERAL) !== undefined;
}

/**
 * Whether a spread is the schema's HTML constraints from `@ramonda/form/bguard`: `html(path)`, where
 * `html` is a `const` made by `htmlConstraints(schema)`. Those carry only validation attributes —
 * `required`, `minlength`, `maxlength`, `min`, `max`, `pattern`, `step`, `type` — and none a field is
 * written with, so the spread cannot take a handler away or make a field controlled.
 *
 * One step, and both halves are questions about declarations: where `html` was declared, and where
 * the function that made it was imported from.
 */
function isConstraints(expression: ts.Expression, resolve: ElementContext["resolve"]): boolean {
  const written = unwrap(expression);
  if (!ts.isCallExpression(written) || !ts.isIdentifier(written.expression)) return false;
  const declaration = resolve(written.expression)?.declarations?.[0];
  if (declaration === undefined || !ts.isVariableDeclaration(declaration)) return false;
  const made = declaration.initializer === undefined ? undefined : unwrap(declaration.initializer);
  if (made === undefined || !ts.isCallExpression(made) || !ts.isIdentifier(made.expression)) return false;
  return resolve.fromPackage(made.expression, "@ramonda/form/bguard");
}

/** Whether a handler is read off a declaration marked optional — `oninput?:` on a wrapper's props. */
function declaredOptional(expression: ts.Expression | undefined, resolve: ElementContext["resolve"]): boolean {
  if (expression === undefined) return false;
  const written = unwrap(expression);
  const name = ts.isPropertyAccessExpression(written) ? written.name : ts.isIdentifier(written) ? written : undefined;
  if (name === undefined) return false;
  return (resolve(name)?.declarations ?? []).some(
    (declaration) =>
      (ts.isPropertySignature(declaration) || ts.isPropertyDeclaration(declaration) || ts.isParameter(declaration)) &&
      declaration.questionToken !== undefined,
  );
}

/** `<input>` types whose pick sends `input` and then `change` at once, with no typing between. */
const PICKED_AT_ONCE: ReadonlySet<string> = new Set([
  "date",
  "time",
  "month",
  "week",
  "datetime-local",
  "color",
  "range",
]);

/**
 * A controlled field the page can never change.
 *
 * A field with a `value` — a `checked` on a checkbox or radio — shows what the model holds, and the
 * handler ON the field is what writes the model: core answers every edit in the field's own listener,
 * calls that handler, and makes the field show the model before anything else reads it. So a
 * controlled field with no handler of its own cannot be changed at all, whatever is written around it
 * — a form's `oninput` runs after the field has shown its model again.
 *
 * What is reported, each provable from the source:
 *
 * - **No handler on the field** — no `oninput` (for a select, a checkbox or a radio, no `oninput` or
 *   `onchange`), or the same written `on:input`, which core calls as the field's own on every field.
 * - **A text field with only `onchange`** — `change` comes on blur, so every keystroke before it is
 *   undone.
 * - **`value` beside `defaultValue`**, or `checked` beside `defaultChecked` — the first wins and the
 *   second says nothing.
 * - **A text field whose `value` is a literal** — `value=""`, `{-1}`, or a `const` holding one — which
 *   no handler can move. A `Select`'s literal is a pattern, an action menu that goes back to its
 *   placeholder once its handler acts, and is not reported.
 * - **A spread on a field**, with a `value` written beside it or not: what it holds is not written
 *   down, and it may carry a `value` without the handler. The one spread that says what it holds is
 *   the schema's HTML constraints, `html(path)` from `@ramonda/form/bguard` — see `isConstraints`.
 *   A spread of a prop, `{...this.props.attrs}`, is read where the component is used, by
 *   `form-field-without-what-the-form-needs`.
 * - **A box picked through `onclick`** — it works for a click, but a pick sent without one — a
 *   `change` a test or a script dispatches — never reaches it, and the field puts the box back.
 * - **A handler that is an optional prop** — `oninput={this.props.oninput}` where the props declare
 *   `oninput?:` — whose caller may leave it out.
 *
 * Not reported: a field that is `disabled` as written, or a text field that is `readonly`, which takes
 * no input — `readonly` does nothing to a select, a checkbox or a radio; an `<input>` whose type is
 * not edited (`hidden`, `submit`, `button`, `reset`, `image`, `file`); and a field whose `value` or
 * `checked` is `null` or `undefined` as written, which is no model.
 */
export const fieldTheUserCannotChange = {
  id: "field-the-user-cannot-change",

  report: {
    severity: "error",
    reportedWhen:
      "a controlled field — a `Select`, a `TextArea` or an `<input>` with a `value` or a `checked` — has no " +
      "handler of its own that writes the model, a text field has only `onchange`, a text field's value is " +
      "written as itself, a spread on it cannot be read, its handler is an optional prop, or `value` sits " +
      "beside `defaultValue`",
    heading: (found) => `${found.length} field(s) the user cannot change:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component}> ${
        {
          "no-handler": "has a value and no handler of its own — every edit shows the model again at once.",
          "held-between-keystrokes":
            "has a value and only `onchange`, which comes on blur — every keystroke is undone before it.",
          both: "has a value and a default — the value wins, and the default says nothing.",
          literal: "has a value written as itself — no handler can move it, so every edit is undone.",
          "unknown-spread": "is controlled, and a spread on it may or may not carry its handler — nothing says which.",
          "handler-may-be-missing": "takes its handler from a prop declared optional — a caller may leave it out.",
          "change-after-its-input":
            "has a value and only `onchange`, which comes after the `input` the field already answered — write it as `oninput`.",
          "pick-through-click":
            "takes its pick through `onclick`, which a pick sent without a click never reaches — write it as `onchange`.",
        }[issue.kind]
      }`,
    ],
    advice:
      "A controlled field shows what the model holds, and its own handler is what writes the model:\n" +
      "core calls it, then shows the model, before the event bubbles to anything around the field.\n\n" +
      "Write the model in the field's own handler:\n\n" +
      "```tsx\n" +
      "typed(event: EventOn<HTMLTextAreaElement>) {\n" +
      "  this.draft = event.currentTarget.value;\n" +
      "}\n\n" +
      '<TextArea aria-label="Draft" value={this.draft} oninput={this.typed} />\n' +
      "```\n\n" +
      "Or, for a field whose value is read when the form is sent, say where it STARTS:\n\n" +
      "```tsx\n" +
      '<input name="email" defaultValue={this.saved} />\n' +
      "```\n\n" +
      "To refuse an edit, the handler writes nothing; to rewrite it, the handler writes what the field\n" +
      "should show.\n\n",
  },

  /**
   * A spread is the one place a controlled field's handler can hide, so the rule reads the element
   * with one — to accept the schema's constraints, and to report any other spread on a field.
   */
  evenWhenSpreading: true,

  read(element, { resolve, truth, attributes }) {
    const opening = openingOf(element);
    const core = coreElementTag(opening.tagName, resolve);
    const host = ts.isIdentifier(opening.tagName) && opening.tagName.text === "input" ? "input" : undefined;
    const tag = core ?? host;
    if (tag !== "select" && tag !== "textarea" && tag !== "input") return [];
    const component = tag === "select" ? "Select" : tag === "textarea" ? "TextArea" : "input";

    // `{null}` and `{undefined}` — data still loading — are no value: the field is the user's.
    const said = (name: string) =>
      attributes.find((attribute) => attribute.name === name && !writtenAsNothing(attribute, resolve));

    // Every string its `type` can be, read once, for its kind (see `kindOfLiterals`) and, below, whether
    // it is a picker. One whose type cannot be read is a box when it is written with `checked` — a
    // `value` beside it is then what the box sends, as on a radio.
    const typeAttribute = tag === "input" ? typeAttributeOf(element) : undefined;
    const types = typeAttribute === undefined ? undefined : typeLiterals(typeAttribute, resolve);
    const kind = typeAttribute === undefined ? "text" : kindOfLiterals(types);
    if (kind === "unedited") return [];
    const box = kind === "box" || (kind === "unread" && said("checked") !== undefined);
    const pick = tag === "select" || box;
    const model = said(box ? "checked" : "value");
    const spreads = opening.attributes.properties.filter(ts.isJsxSpreadAttribute);
    // Any spread but the schema's constraints may carry a `value` — which makes the field controlled —
    // and nothing says whether it carries the handler too: reported whether or not a value is written.
    // `{...this.props.P}` is read where the component is used, by `form-field-without-what-the-form-needs`.
    const unknown = spreads.some(
      (spread) => !isConstraints(spread.expression, resolve) && propRead(spread.expression) === undefined,
    );
    if (model === undefined && !unknown) return [];

    const at = positionOf(opening);
    // `both` only where a model is written: beside a spread alone, a default is the spread's question.
    if (model !== undefined && said(box ? "defaultChecked" : "defaultValue") !== undefined) {
      return [{ component, kind: "both", ...at }];
    }

    // `readonly` takes the input away from a text field, and does nothing to a pick.
    const still = pick ? ["disabled"] : ["readonly", "readOnly", "disabled"];
    if (still.some((name) => truth(name) === true)) return [];
    if (!pick && model !== undefined && writtenAsItself(model, resolve)) {
      return [{ component, kind: "literal", ...at }];
    }
    if (unknown) return [{ component, kind: "unknown-spread", ...at }];

    // `oninput` or `on:input`: both are the field's own handler, which core calls before it shows the model.
    const own = (name: string) =>
      attributes.find(
        (attribute) =>
          (attribute.name === name || attribute.name === `on:${name.slice(2)}`) &&
          !writtenAsNothing(attribute, resolve),
      );
    const writer = own("oninput") ?? (pick ? own("onchange") : undefined);
    if (writer === undefined) {
      if (!pick && own("onchange") !== undefined) {
        // A date, a time, a color or a range sends `input` and then `change` for one pick: the field
        // answers the `input`, and `onchange` reads what it already showed again.
        // Every type the field can be is a picker: `withTime ? "datetime-local" : "date"` is one.
        if (types !== undefined && types.every((one) => PICKED_AT_ONCE.has(one.toLowerCase()))) {
          return [{ component, kind: "change-after-its-input", ...at }];
        }
        return [{ component, kind: "held-between-keystrokes", ...at }];
      }
      // `onclick` on a box hears a click, not a pick: a pick sent without one never reaches it.
      const click = attributes.find(
        (attribute) => attribute.name === "onclick" && !writtenAsNothing(attribute, resolve),
      );
      if (pick && click !== undefined) return [{ component, kind: "pick-through-click", ...at }];
      return [{ component, kind: "no-handler", ...at }];
    }
    if (declaredOptional(writer.value, resolve)) return [{ component, kind: "handler-may-be-missing", ...at }];
    return [];
  },
} as const satisfies ElementRule<FieldTheUserCannotChangeIssue>;
