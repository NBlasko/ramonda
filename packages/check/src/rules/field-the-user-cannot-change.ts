import ts from "typescript";
import { positionOf } from "../syntax";
import { coreElementTag } from "./coreElements";
import { openingOf, writtenAsNothing } from "./element";
import { follow, unwrap, type Looking } from "./follow-value";
import type { ElementContext, ElementRule, WrittenAttribute } from "./rule";

export interface FieldTheUserCannotChangeIssue {
  component: "Select" | "TextArea" | "input";
  /**
   * `no-handler` — a controlled field with no handler of its own that writes the model;
   * `held-between-keystrokes` — a text field whose only handler is `onchange`, on blur;
   * `both` — `value` beside `defaultValue`, or `checked` beside `defaultChecked`;
   * `literal` — a text field's `value` written as itself, `value=""`, which no handler can move;
   * `unknown-spread` — a spread on a controlled field that the source cannot say carries a handler;
   * `handler-may-be-missing` — the field's handler is a prop declared optional, `oninput?:`.
   */
  kind: "no-handler" | "held-between-keystrokes" | "both" | "literal" | "unknown-spread" | "handler-may-be-missing";
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
 * The tag that marks a declaration as a FIELD BINDING: an object made to be spread onto a control,
 * which carries the control's value and its own `oninput`. `@ramonda/form` writes it on `$.bind`.
 *
 * A JSDoc tag, because this package asks the compiler where a name was declared and never what type
 * anything is — and a tag is part of the declaration, kept in a published `.d.ts` as in the source.
 */
export const FIELD_BINDING_TAG = "ramondaFieldBinding";

/** Whether a spread's expression is a declaration marked as a field binding — see `FIELD_BINDING_TAG`. */
function isFieldBinding(expression: ts.Expression, resolve: ElementContext["resolve"]): boolean {
  const written = unwrap(expression);
  const name = ts.isPropertyAccessExpression(written) ? written.name : ts.isIdentifier(written) ? written : undefined;
  if (name === undefined) return false;
  return (resolve(name)?.declarations ?? []).some((declaration) =>
    ts.getJSDocTags(declaration).some((tag) => tag.tagName.text === FIELD_BINDING_TAG),
  );
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

/** `<input>` types whose `value` is not something the user edits: a label, a hidden value, a file list. */
const NOT_EDITED = new Set(["hidden", "submit", "button", "reset", "image", "file"]);

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
 *   `onchange`), spelled so: the field's handler is the one core calls, and `on:input` is a listener
 *   of its own.
 * - **A text field with only `onchange`** — `change` comes on blur, so every keystroke before it is
 *   undone.
 * - **`value` beside `defaultValue`**, or `checked` beside `defaultChecked` — the first wins and the
 *   second says nothing.
 * - **A text field whose `value` is a literal** — `value=""`, `{-1}`, or a `const` holding one — which
 *   no handler can move. A `Select`'s literal is a pattern, an action menu that goes back to its
 *   placeholder once its handler acts, and is not reported.
 * - **A spread on a controlled field** that the source cannot say carries a handler: what it holds is
 *   not written down. A field binding is — `$.bind` from `@ramonda/form`, marked `@ramondaFieldBinding`.
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
        }[issue.kind]
      }`,
    ],
    advice:
      "A controlled field shows what the model holds, and its own handler is what writes the model:\n" +
      "core calls it, then shows the model, before any other listener reads the field.\n\n" +
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
      "To refuse or rewrite an edit, give the field a `transform` — a pure function it runs before any\n" +
      "handler reads it.\n\n",
  },

  /**
   * A spread is the one place a controlled field's handler can hide, so the rule reads the element
   * with one — to accept a field binding, and to report any other spread on a controlled field.
   */
  evenWhenSpreading: true,

  read(element, { resolve, truth, attributes, attr }) {
    const opening = openingOf(element);
    const core = coreElementTag(opening.tagName, resolve);
    const host = ts.isIdentifier(opening.tagName) && opening.tagName.text === "input" ? "input" : undefined;
    const tag = core ?? host;
    if (tag !== "select" && tag !== "textarea" && tag !== "input") return [];
    const component = tag === "select" ? "Select" : tag === "textarea" ? "TextArea" : "input";

    const type = tag === "input" ? attr("type")?.toLowerCase() : undefined;
    if (type !== undefined && NOT_EDITED.has(type)) return [];
    const box = type === "checkbox" || type === "radio";
    const pick = tag === "select" || box;

    // `{null}` and `{undefined}` — data still loading — are no value: the field is the user's.
    const said = (name: string) =>
      attributes.find((attribute) => attribute.name === name && !writtenAsNothing(attribute));
    const model = said(box ? "checked" : "value");
    const spreads = opening.attributes.properties.filter(ts.isJsxSpreadAttribute);
    const bound = spreads.some((spread) => isFieldBinding(spread.expression, resolve));
    if (model === undefined && !bound) return [];

    const at = positionOf(opening);
    if (said(box ? "defaultChecked" : "defaultValue") !== undefined) return [{ component, kind: "both", ...at }];

    // `readonly` takes the input away from a text field, and does nothing to a pick.
    const still = pick ? ["disabled"] : ["readonly", "readOnly", "disabled"];
    if (still.some((name) => truth(name) === true)) return [];
    if (!pick && model !== undefined && writtenAsItself(model, resolve)) {
      return [{ component, kind: "literal", ...at }];
    }
    if (bound) return [];
    if (spreads.length > 0) return [{ component, kind: "unknown-spread", ...at }];

    const own = (name: string) => attributes.find((attribute) => attribute.name === name);
    const writer = own("oninput") ?? (pick ? own("onchange") : undefined);
    if (writer === undefined) {
      if (!pick && own("onchange") !== undefined) return [{ component, kind: "held-between-keystrokes", ...at }];
      return [{ component, kind: "no-handler", ...at }];
    }
    if (declaredOptional(writer.value, resolve)) return [{ component, kind: "handler-may-be-missing", ...at }];
    return [];
  },
} as const satisfies ElementRule<FieldTheUserCannotChangeIssue>;
