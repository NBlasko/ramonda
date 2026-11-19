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
 * `undefined` for a computed name (`[key]()`) and a string-literal name: those are members a rule
 * cannot report BY NAME, and every caller skips them.
 *
 * A private `#field` HAS a name — `#field` — and used to be in that list, which cost every caller
 * something different and all of it silent: `server-env-in-shared-code` reported one as
 * `(anonymous)` and could not excuse it, the render walk never followed `this.#helper()`, and
 * `stale-field` could not see one go stale. Found in review by planting the `#` spelling of a shape
 * the `private` spelling already handled.
 */
export function memberName(member: ts.ClassElement): string | undefined {
  if (member.name === undefined) return undefined;
  if (ts.isIdentifier(member.name) || ts.isPrivateIdentifier(member.name)) return member.name.text;
  return undefined;
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

/**
 * How a hook's props callback names the component it belongs to: `this`, the parameter the docs
 * write it with — `(self: App) => self.tick` — or that parameter destructured, `({ tick }) => tick`.
 *
 * One answer for every rule that reads a props callback, and every name in it matched by the
 * declaration it RESOLVES to, never by its text: an inner `(self) => self.rate` is somebody else's
 * `self`, and `[1, 2].map((rate) => rate * 2)` inside `({ rate }) => …` is somebody else's `rate`.
 * `this` is the owner only where it is the root's — a `function` written inside has a `this` of its
 * own (`bindsThis`), on the read side as on the write side.
 *
 * Given a body with no parameter — a method's or a getter's, which a rule follows into — the owner is
 * `this` and nothing else.
 */
export interface CallbackOwner {
  /** Whether this expression IS the owner — the root's `this`, or the parameter itself. */
  is(expression: ts.Expression): boolean;
  /** The member a destructured local reads — `{ tick: t }` makes `t` read `tick` — or `undefined`. */
  member(id: ts.Identifier): string | undefined;
  /** Whether this expression is the parameter's REST copy, `{ ...all }` — every member, copied at the call. */
  isRest(expression: ts.Expression): boolean;
}

export function callbackOwner(root: ts.Node, resolve: (id: ts.Node) => ts.Symbol | undefined): CallbackOwner {
  const parameter =
    ts.isArrowFunction(root) ||
    ts.isFunctionExpression(root) ||
    ts.isFunctionDeclaration(root) ||
    ts.isMethodDeclaration(root)
      ? root.parameters[0]
      : undefined;
  const members = new Map<ts.Node, string>();
  const rests: ts.Node[] = [];
  if (parameter !== undefined && ts.isObjectBindingPattern(parameter.name)) {
    for (const element of parameter.name.elements) {
      if (!ts.isIdentifier(element.name)) continue;
      if (element.dotDotDotToken !== undefined) {
        rests.push(element);
        continue;
      }
      const member = element.propertyName ?? element.name;
      if (ts.isIdentifier(member)) members.set(element, member.text);
    }
  }
  const declarations = (id: ts.Node): readonly ts.Node[] => resolve(id)?.declarations ?? [];
  return {
    is: (expression) =>
      (expression.kind === ts.SyntaxKind.ThisKeyword && thisIsTheRoots(expression, root)) ||
      (parameter !== undefined &&
        ts.isIdentifier(parameter.name) &&
        ts.isIdentifier(expression) &&
        declarations(expression).includes(parameter)),
    member: (id) => {
      for (const declaration of declarations(id)) {
        const member = members.get(declaration);
        if (member !== undefined) return member;
      }
      return undefined;
    },
    isRest: (expression) =>
      rests.length > 0 && ts.isIdentifier(expression) && declarations(expression).some((one) => rests.includes(one)),
  };
}

/** Whether a `this` written under `root` is the root's: no `function`, class or object method between. */
function thisIsTheRoots(self: ts.Node, root: ts.Node): boolean {
  for (let at = self.parent; at !== undefined && at !== root; at = at.parent) {
    if (bindsThis(at)) return false;
  }
  return true;
}

/** Whether an identifier is a READ of a local, rather than where it is declared or a property name. */
export function isLocalRead(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isBindingElement(parent) || ts.isParameter(parent) || ts.isVariableDeclaration(parent))
    return parent.name !== node;
  if (ts.isPropertyAccessExpression(parent)) return parent.expression === node;
  if (ts.isPropertyAssignment(parent)) return parent.initializer === node;
  return true;
}

/**
 * Whether a function is HANDED OVER as a value in an object literal — `run: () => …`, `fetch() {}` —
 * rather than called where it is written.
 *
 * A read inside one is not a read by the code around it: a props callback that returns
 * `{ run: () => this.tick }` never evaluates `this.tick`, so nothing it read can run it again —
 * measured, the runtime reports nothing for it. A function passed to a CALL is different:
 * `self.items.map((n) => n * self.rate)` runs right there, and its reads are the caller's.
 */
export function isHandedOver(node: ts.Node): boolean {
  if (ts.isMethodDeclaration(node)) return ts.isObjectLiteralExpression(node.parent);
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return false;
  const parent = node.parent;
  return (ts.isPropertyAssignment(parent) && parent.initializer === node) || ts.isShorthandPropertyAssignment(parent);
}

/**
 * Every identifier or property access an assignment's left side writes, through any destructuring —
 * `[a, this.b] = list`, `({ a, c: this.c } = cfg)`, `[a = 1] = list`.
 */
export function targetsOf(left: ts.Node, into: ts.Expression[]): void {
  if (ts.isIdentifier(left) || ts.isPropertyAccessExpression(left)) into.push(left);
  else if (ts.isParenthesizedExpression(left)) targetsOf(left.expression, into);
  else if (ts.isArrayLiteralExpression(left)) for (const one of left.elements) targetsOf(one, into);
  else if (ts.isObjectLiteralExpression(left)) {
    for (const one of left.properties) {
      if (ts.isShorthandPropertyAssignment(one)) into.push(one.name);
      else if (ts.isPropertyAssignment(one)) targetsOf(one.initializer, into);
      else if (ts.isSpreadAssignment(one)) targetsOf(one.expression, into);
    }
  } else if (ts.isSpreadElement(left)) targetsOf(left.expression, into);
  else if (ts.isBinaryExpression(left) && left.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    targetsOf(left.left, into);
  }
}

/** Whether a class member is `static` — its `this` is the class, not an instance. */
export function isStatic(member: ts.Node): boolean {
  return (
    ts.canHaveModifiers(member) &&
    ts.getModifiers(member)?.some((one) => one.kind === ts.SyntaxKind.StaticKeyword) === true
  );
}

/**
 * A node with a `this` of its own: a nested class, a `function`, a method or accessor of an object
 * literal. Only an arrow keeps the `this` around it.
 */
export function bindsThis(node: ts.Node): boolean {
  return (
    ts.isClassDeclaration(node) ||
    ts.isClassExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ((ts.isMethodDeclaration(node) || ts.isAccessor(node)) && ts.isObjectLiteralExpression(node.parent))
  );
}

/**
 * Every target written under a node — an assignment of any operator (`??=` and `||=` are writes like any
 * other), `++`/`--`, a `for…of` — through any pattern, with `this` kept bound if asked.
 */
export function writesUnder(root: ts.Node, keepThis: boolean, visit: (target: ts.Expression) => void): void {
  (function walk(at: ts.Node): void {
    if (keepThis && at !== root && bindsThis(at)) return;
    const targets: ts.Expression[] = [];
    if (
      ts.isBinaryExpression(at) &&
      at.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      at.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      targetsOf(at.left, targets);
    } else if (
      (ts.isPostfixUnaryExpression(at) || ts.isPrefixUnaryExpression(at)) &&
      (at.operator === ts.SyntaxKind.PlusPlusToken || at.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      targetsOf(at.operand, targets);
    } else if ((ts.isForOfStatement(at) || ts.isForInStatement(at)) && !ts.isVariableDeclarationList(at.initializer)) {
      targetsOf(at.initializer, targets);
    }
    for (const target of targets) visit(target);
    ts.forEachChild(at, walk);
  })(root);
}

/** `(() => …)()` — a function called where it is written, through any parentheses TypeScript keeps. */
export function invokedOnTheSpot(fn: ts.ArrowFunction | ts.FunctionExpression): boolean {
  let at: ts.Node = fn;
  while (at.parent !== undefined && ts.isParenthesizedExpression(at.parent)) at = at.parent;
  return at.parent !== undefined && ts.isCallExpression(at.parent) && at.parent.expression === at;
}

/** Whether `inner` lies inside `outer` — the same file, and within its span. */
export function contains(outer: ts.Node, inner: ts.Node): boolean {
  return outer.getSourceFile() === inner.getSourceFile() && inner.pos >= outer.pos && inner.end <= outer.end;
}
