import ts from "typescript";
import { positionOf } from "../syntax";
import { coreElementTag } from "./coreElements";
import { isNothing, openingOf, tagOf } from "./element";
import { unwrap } from "./follow-value";
import { enclosingElement } from "./html";
import type { JsxElementLike, ModuleRule, Resolver } from "./rule";
import { fromThePlatform } from "./pure-function";
import { NOT_EDITED } from "./formTable";

export interface ResetTheModelDoesNotHearIssue {
  /**
   * `controlled-field` — a reset button's form holds a field with a `value` (`checked`), which the
   * browser's reset puts back on screen and nothing tells the model; `unseen-content` — its form holds
   * something whose fields cannot be read (a component, `children`, a value); `no-form` — the button is
   * in no `<form>` of the same render; `elsewhere` — it names its form with a `form` attribute;
   * `browser-reset` — `.reset()` is called on something with no declaration and no hook under it,
   * which cannot be told apart from the browser's `HTMLFormElement.reset`.
   */
  kind: "controlled-field" | "unseen-content" | "no-form" | "elsewhere" | "browser-reset";
  /** What the report names: the field, the content, or the call as written. */
  detail: string;
  file: string;
  line: number;
  column: number;
}

/** A `<button type="reset">` or `<input type="reset">`, as written. */
function isResetButton(element: JsxElementLike): boolean {
  const tag = tagOf(element);
  if (tag !== "button" && tag !== "input") return false;
  const type = openingOf(element).attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText().toLowerCase() === "type",
  );
  const value = type?.initializer;
  return value !== undefined && ts.isStringLiteral(value) && value.text.toLowerCase() === "reset";
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
  const type = attributeOf(element, "type")?.initializer;
  // A reset, a submit or a hidden value is not edited, and a reset does not move it.
  if (type !== undefined && ts.isStringLiteral(type) && NOT_EDITED.has(type.text.toLowerCase())) return false;
  const typed = type !== undefined && ts.isStringLiteral(type) ? type.text.toLowerCase() : undefined;
  const box = typed === "checkbox" || typed === "radio";
  const model = attributeOf(element, box ? "checked" : "value");
  if (model === undefined) return false;
  const value = model.initializer;
  if (value === undefined) return true;
  const written = ts.isJsxExpression(value) ? value.expression : value;
  return written !== undefined && !isNothing(written);
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
      isNothing(written)
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
 * - `.reset()` that names a declaration, or is called on a hook (`this.form.reset()`, a field of one).
 *   Anything else cannot be told apart from the browser's `HTMLFormElement.reset`, and is reported —
 *   a value whose type this cannot see (what `Map.get` returns) is given one it can: `const tab: Tab = …`.
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
          "browser-reset": `\`${issue.detail}\` names no declaration and no hook, so it cannot be shown to be anything but the browser's form reset — fields go back on screen and no model hears.`,
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
      if ((ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && isResetButton(node)) {
        const at = positionOf(openingOf(node));
        let form: JsxElementLike | undefined = enclosingElement(node);
        while (form !== undefined && tagOf(form) !== "form") form = enclosingElement(form);
        if (attributeOf(node, "form") !== undefined) found.push({ kind: "elsewhere", detail: "", ...at });
        else if (form === undefined) found.push({ kind: "no-form", detail: "", ...at });
        else {
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
      if (ts.isCallExpression(node)) {
        const callee = unwrap(node.expression);
        if (ts.isPropertyAccessExpression(callee) && callee.name.text === "reset") {
          const declared = resolve(callee.name)?.declarations?.[0];
          if (fromThePlatform(declared) && !rootedInAHook(callee.expression, resolve, file)) {
            found.push({ kind: "browser-reset", detail: `${callee.getText()}()`, ...positionOf(node) });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    return found;
  },
} as const satisfies ModuleRule<ResetTheModelDoesNotHearIssue>;
