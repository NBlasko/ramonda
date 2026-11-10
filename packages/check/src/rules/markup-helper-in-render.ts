import ts from "typescript";
import { memberName, positionOf } from "../syntax";
import type { Rule } from "./rule";

/**
 * A function that returns markup, built inside `render()` and only called there.
 *
 * Found by the second trial: nine column headings written as
 * `const head = (key, cls) => <th …>…</th>` at the top of `render()` and called nine times. It is
 * the everyday shape where a component is a function, and nothing said otherwise:
 * `function-built-in-the-markup` is about a function HANDED to the markup, this one is only called,
 * and the silence read as "fine here". The user found it in review.
 *
 * In a class it is a piece of the rendering hidden where a subclass cannot override it, a test
 * cannot call it and the devtools cannot show it, and it is a new closure on every render. The one
 * place the docs said what to do instead was a sentence in a type table — "annotate with
 * `RamondaNode` when a method other than `render()` returns markup".
 *
 * ## What is reported
 *
 * A `const name = () => …`, `const name = function () {…}` or `function name() {…}` written
 * anywhere inside `render()` — a row callback's body included, where it is built once per row —
 * whose body has markup in it, a row callback inside it included, and whose name is only ever
 * CALLED.
 *
 * ## What is not
 *
 * - **A function handed to something**, `list(rows, row)` or `rows.map(row)`, inline or lifted into
 *   a local. A row callback has to be a value, and handing one over is what `list` asks for. A
 *   helper both called and handed over is left to the handed half's rules.
 * - **A function returning no markup**: a formatter is not rendering.
 * - **A closure in another method.** Only `render()` runs on every render, and a method is where
 *   the advice sends the helper anyway.
 */
export interface MarkupHelperInRenderIssue {
  component: string;
  /** The helper's name, which becomes the method's. */
  helper: string;
  file: string;
  line: number;
  column: number;
}

/**
 * Whether a function's body holds markup — a row callback nested in it included: `(xs) => list(xs,
 * (x) => <li>{x}</li>)` returns a list of rows, and skipping nested functions hid it. Measured by
 * planting it, after the first version skipped them and no test noticed.
 */
function returnsMarkup(fn: ts.FunctionLikeDeclaration): boolean {
  const body = fn.body;
  if (body === undefined) return false;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  if (ts.isBlock(body)) ts.forEachChild(body, visit);
  else visit(body);
  return found;
}

/** The function a declaration names, through a cast or parentheses. */
function functionOf(node: ts.Node): { name: ts.Identifier; fn: ts.FunctionLikeDeclaration } | undefined {
  if (ts.isFunctionDeclaration(node) && node.name) return { name: node.name, fn: node };
  if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer) return undefined;
  let value: ts.Expression = node.initializer;
  while (ts.isParenthesizedExpression(value) || ts.isAsExpression(value) || ts.isSatisfiesExpression(value))
    value = value.expression;
  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return { name: node.name, fn: value };
  return undefined;
}

export const markupHelperInRender = {
  id: "markup-helper-in-render",

  report: {
    severity: "error",
    reportedWhen:
      "a function that returns markup is built inside `render()` and only called there, where a method would be",
    heading: (found) => `${found.length} markup helper(s) built inside \`render()\`:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component}> builds \`${issue.helper}\` inside render() and calls it there — a new closure`,
      `    on every render, and a piece of the rendering no subclass, test or devtools panel can reach.`,
    ],
    advice:
      "Make it a method of the class, typed `RamondaNode`, and call it as `this.<name>(…)`:\n\n" +
      "    columnHead(key: string): RamondaNode {\n" +
      "      return <th>{key}</th>;\n" +
      "    }\n\n" +
      "What it read from `render()`'s locals becomes its arguments. A row callback HANDED to `list()` is\n" +
      "not this: handing one over is what `list()` asks for.",
  },

  read(cls, { self }) {
    const found: MarkupHelperInRenderIssue[] = [];
    for (const member of cls.members) {
      if (!ts.isMethodDeclaration(member) || memberName(member) !== "render" || !member.body) continue;
      const body = member.body;

      const visit = (node: ts.Node): void => {
        const helper = functionOf(node);
        if (helper && returnsMarkup(helper.fn) && onlyCalled(helper.name, body)) {
          found.push({ component: self.name, helper: helper.name.text, ...positionOf(helper.name) });
        }
        ts.forEachChild(node, visit);
      };
      ts.forEachChild(body, visit);
    }
    return found;
  },
} as const satisfies Rule<MarkupHelperInRenderIssue>;

/**
 * Whether every use of a name inside `render()` is a CALL of it — and there is at least one.
 *
 * Matched by the identifier's text within the one method, which is the scope it was declared in; a
 * shadowing parameter of the same name in a nested function would be counted as a use too, and that
 * can only make this quieter, which is the direction that cannot report correct code.
 */
function onlyCalled(name: ts.Identifier, scope: ts.Node): boolean {
  let calls = 0;
  let other = false;
  const visit = (node: ts.Node): void => {
    if (other) return;
    if (ts.isIdentifier(node) && node !== name && node.text === name.text) {
      const parent = node.parent;
      if (ts.isPropertyAccessExpression(parent) && parent.name === node) return;
      if (ts.isPropertyAssignment(parent) && parent.name === node) return;
      if (ts.isCallExpression(parent) && parent.expression === node) calls++;
      else other = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return calls > 0 && !other;
}
