import ts from "typescript";
import { positionOf } from "../syntax";
import { coreElementTag } from "./coreElements";
import { holdsNothing, openingOf, says, tagOf } from "./element";
import { unwrap } from "./follow-value";
import { enclosingElement } from "./html";
import type { JsxElementLike, ModuleRule, Resolver } from "./rule";
import { attributeLiterals, fieldKind, modelNames, typeAttributeOf } from "./formTable";

export interface ResetTheModelDoesNotHearIssue {
  /**
   * `controlled-field` — a reset button's form holds a field with a `value` (`checked`), which the
   * browser's reset puts back on screen and nothing tells the model; `unseen-content` — its form holds
   * something whose fields cannot be read (a component, `children`, a value); `no-form` — the button is
   * in no `<form>` of the same render; `elsewhere` — it names its form with a `form` attribute;
   * `browser-reset` — the browser's `HTMLFormElement.reset` is reached, by whatever name (`form.reset()`,
   * `const clear = form.reset`, `form["reset"]`, `const { reset } = form`), or `reset` on a value whose
   * type cannot be read with no hook under it, or a key that cannot be read on a form (`form[key]`);
   * `form-cast` — a form is asserted to a type that is not one and does not hold one (`form as unknown
   * as Canvas`), whose `reset()` then cannot be followed; `form-retyped` — `reset` is taken from a
   * value of a type a form fits (`const r: Resettable = form`, then `r.reset()`): it may be the
   * browser's under another declaration.
   */
  kind:
    | "controlled-field"
    | "unseen-content"
    | "no-form"
    | "elsewhere"
    | "browser-reset"
    | "form-cast"
    | "form-retyped";
  /** What the report names: the field, the content, or the call as written. */
  detail: string;
  file: string;
  line: number;
  column: number;
}

/**
 * Whether an element resets its form: `"reset"` when its `type` says so (`type="reset"` or
 * `type={"reset"}`); `"maybe"` for a `<button>` whose `type` cannot be read — written as an expression,
 * or left to a spread — which is asked about its form like a reset, and reported only when that form
 * holds something a reset would undo. An `<input>` whose `type` cannot be read is a text field
 * switching to a password and back, not a button.
 */
function resetsItsForm(element: JsxElementLike, resolve: Resolver): "reset" | "maybe" | undefined {
  const tag = tagOf(element);
  if (tag !== "button" && tag !== "input") return undefined;
  const opening = openingOf(element);
  const type = typeAttributeOf(element);
  // Every string the `type` can be, as written — `busy ? "button" : "submit"` is never a reset.
  const literals = type === undefined ? undefined : attributeLiterals(type, resolve);
  if (literals !== undefined) {
    const resets = literals.filter((literal) => literal.toLowerCase() === "reset").length;
    if (resets === 0) return undefined;
    return resets === literals.length ? "reset" : tag === "button" ? "maybe" : undefined;
  }
  if (tag !== "button") return undefined;
  // A button's `type` that cannot be read, or that a spread may carry.
  if (type !== undefined) return "maybe";
  return opening.attributes.properties.some(ts.isJsxSpreadAttribute) ? "maybe" : undefined;
}

function attributeOf(element: JsxElementLike, name: string): ts.JsxAttribute | undefined {
  return openingOf(element).attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name,
  );
}

/** A field written with its model: `value` (`checked` on a box) holding something. */
function controlledField(element: JsxElementLike, resolve: Resolver): boolean {
  const tag = tagOf(element) ?? coreElementTag(openingOf(element).tagName, resolve);
  if (tag !== "input" && tag !== "select" && tag !== "textarea") return false;
  // What its `type` makes it — see `fieldKind`. A reset, a submit or a hidden value is not edited, and
  // a reset does not move it; one whose type cannot be read is asked about both models.
  const kind = tag === "input" ? fieldKind(typeAttributeOf(element), resolve) : "text";
  // Controlled when any of its models holds something: for a type that cannot be read, `value` and
  // `checked` each — a `value={undefined}` beside a `checked` hides nothing.
  return modelNames(kind).some((name) => says(openingOf(element), name, resolve));
}

/**
 * What a form holds that a reset could reach without this seeing it — the first such thing, or the
 * first controlled field.
 */
function firstProblem(
  form: JsxElementLike,
  resolve: Resolver,
): { kind: "controlled-field" | "unseen-content"; at: ts.Node; detail: string } | undefined {
  let found: { kind: "controlled-field" | "unseen-content"; at: ts.Node; detail: string } | undefined;

  const element = (node: JsxElementLike): void => {
    if (found !== undefined) return;
    const opening = openingOf(node);
    const fieldTag = tagOf(node) ?? coreElementTag(opening.tagName, resolve);
    // A spread on a field may carry its `value`, and nothing here can read whether it does — unless
    // the field is one no one edits (`hidden`, `submit`, `reset`), which a reset does not move.
    const notEdited = fieldTag === "input" && fieldKind(typeAttributeOf(node), resolve) === "unedited";
    if (
      (fieldTag === "input" || fieldTag === "select" || fieldTag === "textarea") &&
      !notEdited &&
      opening.attributes.properties.some(ts.isJsxSpreadAttribute)
    ) {
      found = { kind: "unseen-content", at: opening, detail: `a spread on <${opening.tagName.getText()}>` };
      return;
    }
    if (controlledField(node, resolve)) {
      found = { kind: "controlled-field", at: opening, detail: opening.tagName.getText() };
      return;
    }
    const host = tagOf(node);
    const field = host === undefined ? coreElementTag(opening.tagName, resolve) : undefined;
    if (host === undefined && field === undefined) {
      found = { kind: "unseen-content", at: opening, detail: `<${opening.tagName.getText()}>` };
      return;
    }
    if (ts.isJsxElement(node)) children(node.children);
  };

  const children = (list: ts.NodeArray<ts.JsxChild>): void => {
    for (const child of list) {
      if (found !== undefined) return;
      if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) element(child);
      else if (ts.isJsxFragment(child)) children(child.children);
      else if (ts.isJsxExpression(child) && child.expression !== undefined) expression(child.expression);
    }
  };

  /** A `{…}` child: seen only when every value it can be is written here. */
  const expression = (node: ts.Expression): void => {
    if (found !== undefined) return;
    const written = unwrap(node);
    if (ts.isJsxElement(written) || ts.isJsxSelfClosingElement(written)) return element(written);
    if (ts.isJsxFragment(written)) return children(written.children);
    if (
      ts.isStringLiteralLike(written) ||
      ts.isNumericLiteral(written) ||
      written.kind === ts.SyntaxKind.TrueKeyword ||
      written.kind === ts.SyntaxKind.FalseKeyword ||
      holdsNothing(written, resolve)
    ) {
      return;
    }
    if (ts.isTemplateExpression(written)) return;
    if (ts.isConditionalExpression(written)) {
      expression(written.whenTrue);
      expression(written.whenFalse);
      return;
    }
    if (ts.isBinaryExpression(written)) {
      const op = written.operatorToken.kind;
      if (
        op === ts.SyntaxKind.AmpersandAmpersandToken ||
        op === ts.SyntaxKind.BarBarToken ||
        op === ts.SyntaxKind.QuestionQuestionToken
      ) {
        // `a || b` and `a ?? b` render `a` when it holds something; `a && b` renders `b`, or a falsy
        // `a` that is no markup.
        if (op !== ts.SyntaxKind.AmpersandAmpersandToken) expression(written.left);
        expression(written.right);
        return;
      }
    }
    // `list(rows, (row) => <…>)` or `rows.map((row) => <…>)`: the callback's markup is written here.
    if (ts.isCallExpression(written)) {
      const callback = written.arguments.find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
      const callee = unwrap(written.expression);
      const name = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isIdentifier(callee)
          ? callee.text
          : "";
      if ((name === "map" || name === "list") && callback !== undefined) {
        const fn = callback as ts.ArrowFunction | ts.FunctionExpression;
        if (ts.isBlock(fn.body)) {
          const returns: ts.Expression[] = [];
          const look = (inner: ts.Node): void => {
            if (ts.isFunctionLike(inner)) return;
            if (ts.isReturnStatement(inner) && inner.expression !== undefined) returns.push(inner.expression);
            ts.forEachChild(inner, look);
          };
          ts.forEachChild(fn.body, look);
          for (const value of returns) expression(value);
        } else {
          expression(fn.body);
        }
        return;
      }
    }
    found = { kind: "unseen-content", at: written, detail: `{${written.getText()}}` };
  };

  if (ts.isJsxElement(form)) children(form.children);
  return found;
}

/** The class field `this.X` names, when `X` is initialised `this.use(…)` — a hook. */
function isHookField(access: ts.PropertyAccessExpression, file: ts.SourceFile): boolean {
  if (access.expression.kind !== ts.SyntaxKind.ThisKeyword) return false;
  for (let at: ts.Node | undefined = access.parent; at !== undefined && at !== file; at = at.parent) {
    if (!ts.isClassDeclaration(at) && !ts.isClassExpression(at)) continue;
    const member = at.members.find(
      (m): m is ts.PropertyDeclaration =>
        ts.isPropertyDeclaration(m) && ts.isIdentifier(m.name) && m.name.text === access.name.text,
    );
    const init = member?.initializer === undefined ? undefined : unwrap(member.initializer);
    return (
      init !== undefined &&
      ts.isCallExpression(init) &&
      ts.isPropertyAccessExpression(init.expression) &&
      init.expression.name.text === "use" &&
      init.expression.expression.kind === ts.SyntaxKind.ThisKeyword
    );
  }
  return false;
}

/**
 * Whether another assertion stands over this one — through parentheses, `!` and `satisfies`, which
 * change nothing — so this one is not the outermost: `(form as unknown) as Canvas`, but not
 * `(form as unknown as Canvas).reset()`.
 */
function underAnAssertion(node: ts.Node): boolean {
  let above = node.parent;
  while (ts.isParenthesizedExpression(above) || ts.isNonNullExpression(above) || ts.isSatisfiesExpression(above)) {
    above = above.parent;
  }
  return ts.isAsExpression(above) || ts.isTypeAssertionExpression(above);
}

/** Whether a member is only written — `x.reset = clear`, `x[key] = helper` — and so not taken. */
function writtenTo(access: ts.Expression): boolean {
  const parent = access.parent;
  return (
    ts.isBinaryExpression(parent) && parent.left === access && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
  );
}

/** The value a destructuring takes its members from: `const { reset } = form` → `form`. */
function initializerOf(pattern: ts.ObjectBindingPattern): ts.Expression | undefined {
  return ts.isVariableDeclaration(pattern.parent) ? pattern.parent.initializer : undefined;
}

/** Whether `receiver` is rooted in a hook — `this.form`, `this.form.fields.city.$`, or a `const` holding one. */
function rootedInAHook(receiver: ts.Expression, resolve: Resolver, file: ts.SourceFile, depth = 0): boolean {
  if (depth > 8) return false;
  let at = unwrap(receiver);
  for (;;) {
    if (ts.isPropertyAccessExpression(at) && isHookField(at, file)) return true;
    if (ts.isPropertyAccessExpression(at) || ts.isElementAccessExpression(at)) at = unwrap(at.expression);
    else if (ts.isCallExpression(at)) at = unwrap(at.expression);
    else break;
  }
  if (!ts.isIdentifier(at)) return false;
  const declared = resolve(at)?.declarations?.[0];
  if (declared === undefined || !ts.isVariableDeclaration(declared) || declared.initializer === undefined) return false;
  if ((ts.getCombinedNodeFlags(declared) & ts.NodeFlags.Const) === 0) return false;
  return rootedInAHook(declared.initializer, resolve, declared.getSourceFile(), depth + 1);
}

/**
 * A reset the model does not hear.
 *
 * The browser's reset puts every field of a form back to its default on screen and tells nobody: no
 * `input` event, no handler. A field with a `value` then shows one thing while its model holds
 * another. So a reset is allowed where this can prove no such field is reached:
 *
 * - `<button type="reset">` (or `<input type="reset">`) inside a `<form>` of the same render, naming no
 *   other form, whose content is all written there and holds no field with a `value` (`checked`).
 *   A component, `children`, or a value placed in it may hold one, so they are reported too.
 * - `reset` taken from a hook (`this.form.reset()`, a field of one), or from a value whose TYPE a form
 *   does not fit — a canvas context, `CanvasRenderingContext2D`, a class with more to it than a
 *   `reset`. Read off types, never names: the browser's reset is reported under any name it is given
 *   — a type alias, another variable, `const clear = form.reset`, `form["reset"]`, `form[RESET]`,
 *   `const { reset } = form` — and so is `reset` on a type a form fits (`const r: Resettable = form`,
 *   then `r.reset()`), on a value whose type cannot be read, and a form cast to a type that is not one
 *   (`form as unknown as Canvas`), past which it cannot be followed. Give the value a type a form does
 *   not fit: `const context: CanvasRenderingContext2D = …`.
 *
 * **It trusts the type the author writes**, as TypeScript does. A form put through `unknown` or
 * `any` and then given another type — `const x: unknown = form; (x as Canvas).reset()` — is that
 * type from there on: the claim is the author's, and so is what it costs. Reporting every value
 * typed out of `unknown` would report `getContext("2d") as CanvasRenderingContext2D` with it. Writing
 * a form itself as something it is not is reported, as `form-cast`.
 */
export const resetTheModelDoesNotHear = {
  id: "reset-the-model-does-not-hear",

  report: {
    severity: "error",
    reportedWhen:
      "a reset button's form holds a field with a `value` or content that cannot be read, the button is in no " +
      "`<form>` of the same render, or `.reset()` is the browser's",
    heading: (found) => `${found.length} reset(s) the model does not hear:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    ${
        {
          "controlled-field": `This reset's form holds <${issue.detail}> with a value; the reset puts it back on screen and its model never hears.`,
          "unseen-content": `This reset's form holds ${issue.detail}, which may hold a field with a value that cannot be read here.`,
          "no-form": "This reset button is in no <form> of the same render, so what it resets cannot be read.",
          elsewhere: "This reset button names its form with `form`, so what it resets cannot be read.",
          "browser-reset": `\`${issue.detail}\` is the browser's form reset, or a value whose type cannot be read and so cannot be shown not to be — fields go back on screen and no model hears.`,
          "form-cast": `\`${issue.detail}\` is a form cast to a type that is not one, so its reset cannot be followed past here.`,
          "form-retyped": `\`${issue.detail}\` takes \`reset\` from a type a form fits, so it may be the browser's form reset under another declaration — give the value a type a form does not fit.`,
        }[issue.kind]
      }`,
    ],
    advice:
      "A form whose fields have a `value` resets through its model:\n\n" +
      "```tsx\n" +
      "clear(): void {\n" +
      "  this.form.reset();\n" +
      "}\n\n" +
      '<button type="button" onclick={this.clear}>Clear</button>\n' +
      "```\n\n" +
      'A `<button type="reset">` belongs to a form of uncontrolled fields — `defaultValue`, `defaultChecked` —\n' +
      "written in the same render.\n\n",
  },

  read(file, { resolve }) {
    const found: ResetTheModelDoesNotHearIssue[] = [];
    const visit = (node: ts.Node): void => {
      const resets =
        ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) ? resetsItsForm(node, resolve) : undefined;
      if (resets !== undefined && (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node))) {
        const at = positionOf(openingOf(node));
        let form: JsxElementLike | undefined = enclosingElement(node);
        while (form !== undefined && tagOf(form) !== "form") form = enclosingElement(form);
        // A button that only MAY reset is asked about the form it sits in, and nothing else.
        if (attributeOf(node, "form") !== undefined) {
          if (resets === "reset") found.push({ kind: "elsewhere", detail: "", ...at });
        } else if (form === undefined) {
          if (resets === "reset") found.push({ kind: "no-form", detail: "", ...at });
        } else {
          // A form with an `id` takes fields from anywhere that names it — `<input form="id">` — and
          // those cannot be read from here.
          const named = attributeOf(form, "id");
          const problem =
            named !== undefined
              ? {
                  kind: "unseen-content" as const,
                  at: openingOf(form),
                  detail: "a form any field may join by its `id`",
                }
              : firstProblem(form, resolve);
          if (problem !== undefined)
            found.push({ kind: problem.kind, detail: problem.detail, ...positionOf(problem.at) });
        }
      }
      if (
        ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && !writtenTo(node)) ||
        (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent))
      ) {
        const reached = resolve.formReset(node);
        const receiver = ts.isBindingElement(node)
          ? initializerOf(node.parent as ts.ObjectBindingPattern)
          : node.expression;
        // A value whose type cannot be read is not the browser's form when it is a hook's — but a
        // type a form fits is asked of anything, a hook's `current` element included.
        const fromAHook = reached === "maybe" && receiver !== undefined && rootedInAHook(receiver, resolve, file);
        if (reached !== undefined && !fromAHook) {
          // Said as the call where it is one — `form.reset()` — and as the access where the reset is taken.
          const call = ts.isCallExpression(node.parent) && unwrap(node.parent.expression) === node ? node.parent : node;
          const kind = reached === "fits" ? ("form-retyped" as const) : ("browser-reset" as const);
          found.push({ kind, detail: call.getText(), ...positionOf(call) });
        }
      }
      if (
        (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
        !underAnAssertion(node) &&
        resolve.formCast(node)
      ) {
        found.push({ kind: "form-cast", detail: node.getText(), ...positionOf(node) });
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    return found;
  },
} as const satisfies ModuleRule<ResetTheModelDoesNotHearIssue>;
