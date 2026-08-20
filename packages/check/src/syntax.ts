import ts from "typescript";

/**
 * The handful of AST readings that both the analyzer and the rules need.
 *
 * They live here rather than in `analyze.ts` because a rule cannot import from `analyze.ts` — that
 * module imports the rule registry, and a cycle between the two would resolve differently depending
 * on which one the bundler reached first. Nothing in this file knows what a component is, or what a
 * rule is; each function answers one question about a node and takes no context to do it.
 */

/**
 * Where a node is, as a project reports it: a file, a 1-based line, a 1-based column.
 *
 * Every issue any rule produces ends with a spread of this, which is why it is shared rather than
 * written per rule. Editors and the CLI both count from one; the compiler counts from zero.
 */
/**
 * What a class member is called, when it has a plain name to go by.
 *
 * The commonest reading in this package and, before it lived here, its most copied: four rules held a
 * named function for it under two different names, and three more wrote the expression inline. Nothing
 * had drifted yet — but the last thing two copies of one judgement did drift on was which writes leave a
 * cached reader stale, and that was a defect rather than a tidiness question.
 *
 * `undefined` for a computed name (`[key]()`), a string-literal name and a private `#field`: those are
 * members a rule cannot report BY NAME, and every caller skips them.
 */
export function memberName(member: ts.ClassElement): string | undefined {
  return member.name !== undefined && ts.isIdentifier(member.name) ? member.name.text : undefined;
}

/**
 * A decorator's name, whatever spelling reached it — `@updated` or `@created({ … })`.
 *
 * `undefined` for anything that is not a plain identifier at the head, which includes a namespaced
 * `@core.updated`: a rule that went by that spelling would be guessing at an alias.
 */
export function decoratorName(decorator: ts.Decorator): string | undefined {
  const expression = ts.isCallExpression(decorator.expression) ? decorator.expression.expression : decorator.expression;
  return ts.isIdentifier(expression) ? expression.text : undefined;
}

export function positionOf(node: ts.Node): {
  file: string;
  line: number;
  column: number;
} {
  const file = node.getSourceFile();
  const { line, character } = file.getLineAndCharacterOfPosition(node.getStart());
  return { file: file.fileName, line: line + 1, column: character + 1 };
}

/** Whether a call is `this.use(...)` — how a component reaches for a hook. */
export function isThisUse(call: ts.CallExpression): boolean {
  return (
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
    call.expression.name.text === "use"
  );
}

/**
 * The hook a `this.use(...)` names, looking through a type argument list.
 *
 * `this.use(Form<typeof schema>, …)` is an INSTANTIATION EXPRESSION, not an identifier — and every
 * generic hook in the framework is documented to be written that way when the call site cannot infer:
 * `Form<typeof schema>`, `Query<Todo>`, `Field<string>`. Read as an identifier only, none of them
 * resolved, so the owning component was marked opaque and **every consumer below it stopped being
 * judged**. Proved by the `pinned-hook` fixture: with the pin unwrapped the missing provider is
 * reported, and without it the report is silence.
 */
export function hookNamed(arg: ts.Expression): ts.Expression {
  return ts.isExpressionWithTypeArguments(arg) ? arg.expression : arg;
}
