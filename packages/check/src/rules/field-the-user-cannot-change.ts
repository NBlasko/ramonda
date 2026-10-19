import ts from "typescript";
import { positionOf } from "../syntax";
import { coreElementTag } from "./coreElements";
import { contextFor, openingOf, writtenAsNothing } from "./element";
import { eventTypeOf } from "./events";
import { unwrap } from "./follow-value";
import { rowsWalkedBy } from "./row-callback";
import { enclosingElement } from "./html";
import type { ElementContext, ElementRule, JsxElementLike, WrittenAttribute } from "./rule";

export interface FieldTheUserCannotChangeIssue {
  component: "Select" | "TextArea";
  /**
   * `no-handler` — a `value` and nothing that could move it; `held-between-keystrokes` — a
   * `TextArea` whose `value` moves only `onchange`, on blur; `both` — `value` beside `defaultValue`;
   * `literal` — a `value` written as itself, `value=""`, which no handler can move.
   */
  kind: "no-handler" | "held-between-keystrokes" | "both" | "literal";
  file: string;
  line: number;
  column: number;
}

/** Whether a `value` is written as itself — a string, a number or a plain template — not read from anything. */
function writtenAsItself(value: WrittenAttribute): boolean {
  if (value.value === undefined) return false;
  const written = unwrap(value.value);
  return ts.isStringLiteral(written) || ts.isNumericLiteral(written) || ts.isNoSubstitutionTemplateLiteral(written);
}

/** The events an element has a handler for, in any spelling. */
function eventsOf(attributes: readonly WrittenAttribute[]): Set<string | undefined> {
  return new Set(attributes.map((attribute) => eventTypeOf(attribute.name)?.type));
}

/**
 * Whether an element around this one listens for an event that moves the model in time — `<form
 * oninput>`. For a `TextArea` only `input` does: an ancestor's `change` comes on blur, after every
 * keystroke has been undone.
 */
function heardAbove(element: JsxElementLike, events: readonly string[], resolve: ElementContext["resolve"]): boolean {
  for (let at = enclosingElement(element); at !== undefined; at = enclosingElement(at)) {
    // A component's `oninput` is a prop it may hand to a `<form>` inside it, or not: a maybe, and a
    // maybe is never reported. Its spread is not asked about — that question is for a form.
    const around = contextFor(at, resolve);
    // A spread on a form or a fieldset may carry the handler — `<form {...form.events}>` — and a maybe
    // is never reported. One on any other wrapper, a `<div {...attrs}>`, says nothing about input.
    if (around.spreads && (around.tag === "form" || around.tag === "fieldset")) return true;
    const heard = eventsOf(around.attributes);
    if (events.some((event) => heard.has(event))) return true;
  }
  return false;
}

/**
 * Whether the `value` is handed in from outside — `this.props.text`, or `props.text` in a function. The
 * handler that moves it is then the parent's business, and may be an `oninput` on an element of the
 * parent's own render, which this rule, reading one component, cannot see.
 *
 * Silence wherever a prop — or a PARAMETER, handed in by a caller just as a prop is (see
 * `parameterFromOutside` for a callback's) — REACHES the value, since a maybe is never reported: through a fallback or a
 * choice (`?? ""`, `|| ""`, either arm of a ternary), a call (`String(this.props.size)`), a template,
 * or a name taken from the props on the way — `const { text } = this.props`, or `const own =
 * this.props` and then `own.size`. A prop used only as a KEY, `drafts[this.props.id]`, is this
 * component's own model, and is still reported.
 */
function fromProps(value: WrittenAttribute, resolve: ElementContext["resolve"]): boolean {
  return value.value !== undefined && cameFromProps(value.value, resolve, 0, new Set());
}

/** How many names a value is followed through before the answer is "not known" — and silent. */
const HOPS = 20;

function cameFromProps(
  at: ts.Expression,
  resolve: ElementContext["resolve"],
  hops: number,
  seen: Set<ts.Node>,
): boolean {
  // Each expression is asked once: locals built from locals would otherwise branch on both sides
  // at every level.
  if (seen.has(at)) return false;
  seen.add(at);
  const next = (inner: ts.Expression) => cameFromProps(inner, resolve, hops, seen);

  // Parentheses and the type-only wrappers say nothing about where a value comes from.
  const written = unwrap(at);
  if (written !== at) return next(written);
  if (ts.isBinaryExpression(at)) return next(at.left) || next(at.right);
  if (ts.isConditionalExpression(at)) return next(at.whenTrue) || next(at.whenFalse);
  // A method of a prop's value — `this.props.text.trim()` — or a prop handed to a call.
  if (ts.isCallExpression(at)) {
    const callee = at.expression;
    return (ts.isPropertyAccessExpression(callee) && next(callee.expression)) || at.arguments.some(next);
  }
  if (ts.isTemplateExpression(at)) return at.templateSpans.some((span) => next(span.expression));
  // `[this.props.a, this.props.b].map(…)`: what a row is made of.
  if (ts.isArrayLiteralExpression(at)) return at.elements.some(next);
  if (ts.isPropertyAccessExpression(at) || ts.isElementAccessExpression(at)) {
    if (
      ts.isPropertyAccessExpression(at) &&
      at.name.text === "props" &&
      at.expression.kind === ts.SyntaxKind.ThisKeyword
    ) {
      return true;
    }
    // The object read from, not the key: `drafts[this.props.id]` is the component's own `drafts`.
    return next(at.expression);
  }
  if (!ts.isIdentifier(at)) return false;
  if (at.text === "props") return true;

  // A name: where it was declared says where it came from.
  let declaration: ts.Node | undefined = resolve(at)?.declarations?.[0];
  // `const { text } = this.props`, at any depth of the pattern: up to the declaration it is taken from.
  while (
    declaration !== undefined &&
    (ts.isBindingElement(declaration) ||
      ts.isObjectBindingPattern(declaration) ||
      ts.isArrayBindingPattern(declaration))
  ) {
    declaration = declaration.parent;
  }
  if (declaration !== undefined && ts.isParameter(declaration))
    return parameterFromOutside(declaration, resolve, hops, seen);
  if (declaration === undefined || !ts.isVariableDeclaration(declaration) || declaration.initializer === undefined) {
    return false;
  }
  // Past the bound the answer is not known, and a maybe is never reported.
  if (hops >= HOPS) return true;
  return cameFromProps(declaration.initializer, resolve, hops + 1, seen);
}

/**
 * Whether a parameter's value comes from outside what this component holds.
 *
 * A parameter of a method or a function is handed in by whoever calls it — the same "outside" a prop
 * is, and as unknowable here. A parameter of a ROW callback is an item of what the call walks:
 * `this.rows.map((row) => …)` and `list(this.rows, (row) => …)` hand it rows of this component's own
 * model, which is where a field nobody can type in is most often written, so the walked value is
 * followed — `this.props.rows.map(…)` is still the parent's. A row call is one `rowsWalkedBy` names,
 * the set every row rule reads; any other call with a callback is unknown, and silent.
 */
function parameterFromOutside(
  parameter: ts.ParameterDeclaration,
  resolve: ElementContext["resolve"],
  hops: number,
  seen: Set<ts.Node>,
): boolean {
  const fn = parameter.parent;
  if (!(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) return true;
  const call = fn.parent;
  if (!ts.isCallExpression(call) || !call.arguments.includes(fn)) return true;
  const walked = rowsWalkedBy(call);
  if (walked === undefined || walked === fn || hops >= HOPS) return true;
  return cameFromProps(walked, resolve, hops + 1, seen);
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
 * a rule that cannot see it would report every bound field; a field that is `disabled` as written
 * (`truth`: bare, `{true}`, `"true"`, or a name holding it), or a `TextArea` that is `readonly`, which
 * takes no input to undo — `readonly` does nothing to a `<select>`, so a `Select` is still reported;
 * a field with a handler on an ELEMENT around it, `<form oninput>`, which core waits for before it
 * settles — a component's `onchange` is only a prop — or with a spread on a `form` or `fieldset`
 * around it, which may carry one; and a field whose `value` comes from `props` or a parameter, whose
 * handler may sit in the caller's render.
 */
export const fieldTheUserCannotChange = {
  id: "field-the-user-cannot-change",

  report: {
    severity: "error",
    reportedWhen:
      "a `Select` or `TextArea` has a `value` that nothing moves — no handler, a `TextArea` with only " +
      '`onchange`, or a value written as itself (`value=""`) — so every input is undone; or `value` sits ' +
      "beside `defaultValue`",
    heading: (found) => `${found.length} field(s) the user cannot change:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      issue.kind === "literal"
        ? `    <${issue.component} value> is written as itself — no handler can move it, so every input is undone.`
        : issue.kind === "both"
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

  read(element, { resolve, truth, attributes }) {
    const opening = openingOf(element);
    const tag = coreElementTag(opening.tagName, resolve);
    if (tag !== "select" && tag !== "textarea") return [];

    // `{null}` and `{undefined}` — data still loading — are no value: core leaves the field to the
    // user, and so does this. A `defaultValue` written so is no default either.
    const said = (name: string) =>
      attributes.find((attribute) => attribute.name === name && !writtenAsNothing(attribute));
    const value = said("value");
    if (value === undefined) return [];

    const component = tag === "select" ? "Select" : "TextArea";
    const at = positionOf(opening);
    if (said("defaultValue") !== undefined) return [{ component, kind: "both", ...at }];

    const moving: readonly string[] = tag === "textarea" ? ["input"] : ["input", "change"];
    // `readonly` does nothing to a select, which still opens and picks; only `disabled` stops it.
    if ((tag === "select" ? ["disabled"] : ["readonly", "readOnly", "disabled"]).some((name) => truth(name) === true)) {
      return [];
    }
    // A value written as itself — `value=""`, a chat box meant to clear on send — is one no handler
    // can move, wherever the handler is: every input is undone.
    if (writtenAsItself(value)) return [{ component, kind: "literal", ...at }];
    if (heardAbove(element, moving, resolve) || fromProps(value, resolve)) return [];
    const events = eventsOf(attributes);
    if (!events.has("input") && !events.has("change")) return [{ component, kind: "no-handler", ...at }];
    if (tag === "textarea" && !events.has("input")) return [{ component, kind: "held-between-keystrokes", ...at }];
    return [];
  },
} as const satisfies ElementRule<FieldTheUserCannotChangeIssue>;
