import ts from "typescript";
import { callbackOwner, isHandedOver, isLocalRead, isThisUse, memberName, positionOf } from "../syntax";
import { hasDecorator, heritage, memberBody } from "./render-reach";
// The field judgement itself, shared with `row-reads-a-plain-field`: which fields a CACHED reader
// can go stale on, and which writes count. See `stale-field.ts` for why it is not written twice.
import { staleFieldsOf } from "./stale-field";
import type { Resolver, Rule } from "./rule";

/**
 * A CACHED reader — a `@compute` or a hook's props callback — reading an ordinary field that
 * something writes after the first render.
 *
 * ## What actually happens, measured rather than reasoned about
 *
 * A `@compute` caches, and it recomputes when one of the things it TRACKS changes — state and
 * props. An ordinary field is neither, so writing it invalidates nothing. What that costs was
 * measured by running it: a component with `@state tick`, a plain `rate`, and
 * `@compute get total() { return this.tick * this.rate }`.
 *
 * | step | on screen | truth |
 * |---|---|---|
 * | `rate = 10`, no render | `0` | `0` — correct, nothing has changed on screen |
 * | `tick = 1` → renders | `10` | `10` — correct, a tracked dependency moved |
 * | `rate = 100`, then an UNRELATED state change renders | **`10`** | `100` |
 *
 * The last row is the fault, and it is the bad kind: the page re-rendered, everything else on it
 * updated, and this one number is wrong. Nothing throws, nothing is reported at runtime, and the
 * value is wrong rather than missing — somebody reads a total that is not the total.
 *
 * ## Two readers, one fault
 *
 * A `@compute` caches on the state and props it reads. A hook's props callback caches the same way —
 * `this.use(Form, () => ({ schema: this.schema }))` is not called again on a render where none of
 * the signals it read moved. Neither notices an ordinary field, so both hold an answer built from a
 * value that has since changed.
 *
 * They were nearly two rules. They are one because the fault is one: the same set of fields, the
 * same writes, the same fix. Two rules would have been two copies of every judgement below, and
 * this session has spent enough time on pairs that drifted.
 *
 * The runtime reports the props-callback half as `RMD027`, and names the same root cause in its own
 * words: "most often a plain field standing in for state". The `@compute` half has no code of its
 * own — it fails by holding a stale value rather than by being noticed.
 *
 * ## What is deliberately NOT reported, and why each one would be a false report
 *
 * **A field nothing writes after the first render.** A constant a compute reads —
 * `prefix = "Total: "` — can never be stale, and it is the commonest plain field there is. So a
 * WRITE is required, and writes in the constructor, in a field initializer and in `@created` do not
 * count: all three run before the first render, so the first computed value already has the final
 * one.
 *
 * **A write from inside a render or a `@compute`** — the memo pattern,
 * `if (!this.cache) this.cache = expensive()`. Advising `@state` there would be advising a loop.
 * `state-written-while-rendering` is the rule with an opinion about that shape.
 *
 * **`@destroyed`**, which runs after the last render.
 *
 * **A field holding a hook** (`x = this.use(Thing)`) or a function, both of which are read in a
 * compute all the time and are neither state nor stale. Functions are `arrow-fields`' subject.
 *
 * **A field read only by `render()`.** `render()` re-reads on every pass, so it is never stale.
 * The cache is what makes this a fault, so the rule is about `@compute` and nothing else.
 */
export interface CachedReadOfAPlainFieldIssue {
  /** The component or hook. */
  component: string;
  /** Which kind of cached reader it is, because they read differently in a report. */
  reader: "a `@compute`" | "a props callback";
  /** The member that will hold a stale value — the compute, or the field the `this.use` is on. */
  named: string;
  /** The ordinary field it reads — or the variable, when `variable` says so. */
  field: string;
  /** A `let` or `var` declared outside the class rather than a field of it. */
  variable: boolean;
  /** The member or function that writes it, which is what makes it stale. */
  writtenBy: string;
  file: string;
  line: number;
  column: number;
}

/** What a cached reader reads that can go stale: its class's fields, and variables outside it. */
interface Reads {
  /** Every `this.X` read, by name — the caller keeps the ones something writes later. */
  fields: Set<string>;
  /**
   * A `let` or `var` declared outside the reader and written later → its name and that writer. Keyed by
   * the variable, not the name: two modules may each have a `count`.
   */
  variables: Map<ts.Symbol, { name: string; writer: string }>;
}

/** The name a report gives the function a write is in — a method, a function, or neither. */
function writerName(node: ts.Node): string {
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    if ((ts.isFunctionDeclaration(at) || ts.isMethodDeclaration(at)) && at.name !== undefined) return at.name.getText();
    if (ts.isVariableDeclaration(at) && ts.isIdentifier(at.name)) return at.name.text;
    if (ts.isPropertyAssignment(at) || ts.isPropertyDeclaration(at)) return at.name.getText();
    if (ts.isCallExpression(at) && ts.isIdentifier(at.expression))
      return `a callback given to \`${at.expression.text}\``;
  }
  return "a function";
}

/** The function a node runs in, or `undefined` at a module's top level. */
function enclosingFunction(node: ts.Node): ts.Node | undefined {
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    if (ts.isFunctionLike(at) || ts.isClassStaticBlockDeclaration(at)) return at;
  }
  return undefined;
}

/** Every identifier an assignment's left side writes, through any destructuring. */
function targetsOf(left: ts.Node, into: ts.Identifier[]): void {
  if (ts.isIdentifier(left)) into.push(left);
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
    // `[a = 1] = list` — a default inside a pattern.
    targetsOf(left.left, into);
  }
}

/**
 * Whether a write is a LAZY first value — `x ??= make()`, `x ||= make()`, or `if (!x) x = make()` — which
 * fills an empty variable once and never changes a value anybody has read.
 */
function isLazyInit(write: ts.BinaryExpression, symbol: ts.Symbol, resolve: Resolver): boolean {
  const operator = write.operatorToken.kind;
  if (operator === ts.SyntaxKind.QuestionQuestionEqualsToken || operator === ts.SyntaxKind.BarBarEqualsToken)
    return true;
  if (operator !== ts.SyntaxKind.EqualsToken) return false;
  let statement: ts.Node = write.parent;
  if (!ts.isExpressionStatement(statement)) return false;
  if (ts.isBlock(statement.parent) && statement.parent.statements.length === 1) statement = statement.parent;
  const guard = statement.parent;
  if (!ts.isIfStatement(guard) || guard.thenStatement !== statement) return false;
  const tested = guard.expression;
  const isIt = (node: ts.Expression): boolean => ts.isIdentifier(node) && resolve(node) === symbol;
  if (ts.isPrefixUnaryExpression(tested) && tested.operator === ts.SyntaxKind.ExclamationToken)
    return isIt(tested.operand);
  if (ts.isBinaryExpression(tested)) {
    const empty = (node: ts.Expression): boolean =>
      node.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(node) && node.text === "undefined");
    const kind = tested.operatorToken.kind;
    if (kind !== ts.SyntaxKind.EqualsEqualsEqualsToken && kind !== ts.SyntaxKind.EqualsEqualsToken) return false;
    return (isIt(tested.left) && empty(tested.right)) || (isIt(tested.right) && empty(tested.left));
  }
  return false;
}

/**
 * Where a `let` or `var` is written after the class reading it exists — the function holding the first
 * such write, or `undefined` when nothing writes it then.
 *
 * Not a write: one made while its module is first evaluated, or in the function that makes the class
 * (a class declared in a factory), both of which are over before any instance can read it; and a lazy
 * first value (`isLazyInit`). Only the declaring file is read, and that is complete rather than a
 * shortcut: an imported binding is read-only in every module but its own, so no other file can assign it.
 */
function laterWriterOf(
  declaration: ts.VariableDeclaration,
  symbol: ts.Symbol,
  cls: ts.ClassLikeDeclaration,
  resolve: Resolver,
): string | undefined {
  let writer: string | undefined;
  const note = (targets: ts.Identifier[], write?: ts.BinaryExpression): void => {
    for (const target of targets) {
      if (writer !== undefined || resolve(target) !== symbol) continue;
      const runsIn = enclosingFunction(target);
      if (runsIn === undefined) continue;
      if (runsIn.getSourceFile() === cls.getSourceFile() && cls.pos >= runsIn.pos && cls.end <= runsIn.end) continue;
      if (write !== undefined && isLazyInit(write, symbol, resolve)) continue;
      writer = writerName(target);
    }
  };
  (function walk(at: ts.Node): void {
    if (writer !== undefined) return;
    if (
      ts.isBinaryExpression(at) &&
      at.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      at.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      const targets: ts.Identifier[] = [];
      targetsOf(at.left, targets);
      note(targets, at);
    }
    if (
      (ts.isPostfixUnaryExpression(at) || ts.isPrefixUnaryExpression(at)) &&
      (at.operator === ts.SyntaxKind.PlusPlusToken || at.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      const targets: ts.Identifier[] = [];
      targetsOf(at.operand, targets);
      note(targets);
    }
    if ((ts.isForOfStatement(at) || ts.isForInStatement(at)) && !ts.isVariableDeclarationList(at.initializer)) {
      const targets: ts.Identifier[] = [];
      targetsOf(at.initializer, targets);
      note(targets);
    }
    ts.forEachChild(at, walk);
  })(declaration.getSourceFile());
  return writer;
}

/** A `let` or `var` this identifier reads, when it is declared outside `scope` and outside `cls`. */
function outerVariable(
  id: ts.Identifier,
  scope: ts.Node,
  cls: ts.ClassLikeDeclaration,
  resolve: Resolver,
): { declaration: ts.VariableDeclaration; symbol: ts.Symbol } | undefined {
  if (!isLocalRead(id)) return undefined;
  const symbol = resolve(id);
  const declaration = symbol?.declarations?.find((one): one is ts.VariableDeclaration => ts.isVariableDeclaration(one));
  if (symbol === undefined || declaration === undefined) return undefined;
  const list = declaration.parent;
  if (!ts.isVariableDeclarationList(list) || (list.flags & (ts.NodeFlags.Const | ts.NodeFlags.Using)) !== 0)
    return undefined;
  const file = declaration.getSourceFile();
  if (file.isDeclarationFile || file.fileName.includes("node_modules")) return undefined;
  // Declared inside the function being read — a local of its own — or inside the class: neither is
  // outside it, and a local written inside its own function is just a local.
  const inside = (outer: ts.Node): boolean =>
    outer.getSourceFile() === file && declaration.pos >= outer.pos && declaration.end <= outer.end;
  if (inside(scope) || inside(cls)) return undefined;
  return { declaration, symbol };
}

/**
 * Everything a cached reader reads that can go stale — wherever the reading happens.
 *
 * A CALL through `this` is a method, and the method is FOLLOWED: `@compute get total() { return
 * this.priced() }`, where `priced()` reads a plain `rate`, caches exactly the stale answer a direct
 * read would — the compute tracks the signals read while it evaluated, wherever they were read.
 * Reading only the compute's own body reported the version somebody writes on their first day and
 * missed the version that ships. Measured with a plant.
 *
 * A GETTER read through `this` is followed the same way, because reading it runs it; a `@compute`
 * getter is not, because it is a signal. And a call to a FUNCTION this program declares is
 * followed too — it has no `this` of the component's, but it can read a module's `let`, and that
 * goes stale in exactly the same way: nothing about writing a variable invalidates a cache.
 *
 * Bounded and cycle-guarded. A function the program does not declare — a library's, the platform's
 * — is not followed, and what it reads is not known here.
 */
function readsIn(
  node: ts.Node,
  cls: ts.ClassLikeDeclaration,
  declaring: readonly ts.ClassLikeDeclaration[],
  resolve: Resolver,
  writers: Map<ts.Symbol, string | undefined>,
): Reads {
  const reads: Reads = { fields: new Set(), variables: new Map() };
  // A props callback names its owner as `this`, its parameter, or the parameter destructured — see
  // `callbackOwner`. A method the walk follows into has only `this`, and a free function none.
  const callback = callbackOwner(node);
  const walked = new Set<ts.Node>();

  const memberNamed = (name: string): ts.ClassElement[] =>
    declaring.flatMap((one) => one.members.filter((member) => memberName(member) === name));

  const walk = (at: ts.Node, depth: number, hasThis: boolean): void => {
    if (depth > 6 || walked.has(at)) return;
    walked.add(at);

    const owner = at === node ? callback : callbackOwner(at);
    (function look(current: ts.Node): void {
      // A function handed over in an object — a props bag, or one a followed function returns — is not
      // run by the reader. See `isHandedOver`.
      if (current !== at && isHandedOver(current)) return;
      if (ts.isIdentifier(current)) {
        if (hasThis && owner.destructured.has(current.text) && isLocalRead(current)) {
          reads.fields.add(owner.destructured.get(current.text) as string);
        }
        const outer = outerVariable(current, at === node ? node : (at.parent ?? at), cls, resolve);
        if (outer !== undefined && !reads.variables.has(outer.symbol)) {
          // Asked once per variable per class: every read of it would otherwise walk its file again.
          if (!writers.has(outer.symbol))
            writers.set(outer.symbol, laterWriterOf(outer.declaration, outer.symbol, cls, resolve));
          const writer = writers.get(outer.symbol);
          if (writer !== undefined) reads.variables.set(outer.symbol, { name: current.text, writer });
        }
      }
      if (
        hasThis &&
        ts.isPropertyAccessExpression(current) &&
        owner.is(current.expression) &&
        ts.isIdentifier(current.name)
      ) {
        const name = current.name.text;
        const called = ts.isCallExpression(current.parent) && current.parent.expression === current;
        let followed = false;
        for (const member of memberNamed(name)) {
          if (called) {
            const body = memberBody(member);
            if (body) walk(body, depth + 1, true);
            followed = true;
          } else if (ts.isGetAccessorDeclaration(member) && !hasDecorator(member, "compute", resolve) && member.body) {
            walk(member.body, depth + 1, true);
            followed = true;
          }
        }
        if (!called && !followed) reads.fields.add(name);
      }
      if (ts.isCallExpression(current) && ts.isIdentifier(current.expression)) {
        const body = projectFunctionBody(current.expression, resolve);
        if (body !== undefined) walk(body, depth + 1, false);
      }
      ts.forEachChild(current, look);
    })(at);
  };

  walk(node, 0, true);
  return reads;
}

/** The function a name stands for, when this program declares it — or `undefined`. */
function projectFunction(name: ts.Expression, resolve: Resolver): ts.FunctionLikeDeclaration | undefined {
  const declaration = resolve(name)?.declarations?.[0];
  if (declaration === undefined) return undefined;
  const file = declaration.getSourceFile();
  if (file.isDeclarationFile || file.fileName.includes("node_modules")) return undefined;
  if (ts.isFunctionDeclaration(declaration)) return declaration;
  if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
    const value = declaration.initializer;
    if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return value;
  }
  return undefined;
}

function projectFunctionBody(name: ts.Expression, resolve: Resolver): ts.Node | undefined {
  return projectFunction(name, resolve)?.body;
}

/** The function a `this.use` call's second argument is — written there, named, or a method. */
function propsCallback(
  argument: ts.Expression | undefined,
  declaring: readonly ts.ClassLikeDeclaration[],
  resolve: Resolver,
): ts.Node | undefined {
  if (argument === undefined) return undefined;
  if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) return argument;
  if (ts.isIdentifier(argument)) return projectFunction(argument, resolve);
  if (
    ts.isPropertyAccessExpression(argument) &&
    argument.expression.kind === ts.SyntaxKind.ThisKeyword &&
    ts.isIdentifier(argument.name)
  ) {
    const name = argument.name.text;
    for (const one of declaring) {
      const method = one.members.find(
        (member): member is ts.MethodDeclaration => ts.isMethodDeclaration(member) && memberName(member) === name,
      );
      if (method?.body !== undefined) return method;
    }
  }
  return undefined;
}

export const cachedReadOfAPlainField = {
  id: "cached-read-of-a-plain-field",

  report: {
    severity: "error",
    reportedWhen:
      "a `@compute` or a hook's props callback reads an ordinary field written after the first render, or a `let` written inside a function, so the cached value goes stale",
    alsoReportedAs: ["RMD027"],
    heading: (found) => `${found.length} cached read(s) that can hold a stale value:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component}>'s \`${issue.named}\` — ${issue.reader} — reads ` +
        `${issue.variable ? "the variable " : ""}\`${issue.field}\`, ` +
        `which is not state: \`${issue.writtenBy}\` writes it, and that invalidates nothing.`,
    ],
    advice:
      "A `@compute` caches, and it recomputes when something it TRACKS changes — state and props. A\n" +
      "hook's props callback caches the same way. An ordinary field is neither, so writing one\n" +
      "invalidates nothing and the cached value stays.\n\n" +
      "The failure is worth picturing, because it is not a missing update. The page renders again\n" +
      "for some other reason, everything else on it is correct, and this one value is the answer\n" +
      "from before the field changed. Nothing throws and nothing is reported — the number is simply\n" +
      "wrong.\n\n" +
      "Mark the field `@state`. That is what it is: data the render depends on and something\n" +
      "changes. Nothing else about the component has to move. A variable outside the class is the\n" +
      "same fault one step further out: hold the value in `@state` on the component or a hook that\n" +
      "owns it, and read it from there.\n\n" +
      "A field nothing writes after the first render is NOT reported — a constant a compute reads\n" +
      "can never go stale, and neither can one written in the constructor or `@created`.\n\n",
  },

  read(cls, { self, resolve }) {
    /**
     * field → the member that writes it after the first render. Empty means nothing can be stale.
     *
     * `resolve` is handed over so the BASES are asked as well: a plain field on a shared base is
     * this component's field, and goes stale in exactly the same way.
     */
    const writtenBy = staleFieldsOf(cls, resolve);
    /** This class and its bases — what a `this.method()` hop out of a cached reader can land in. */
    const declaring = [cls, ...heritage(cls, resolve)];

    const found: CachedReadOfAPlainFieldIssue[] = [];
    /** Each outer variable's later writer, asked once for the class. */
    const writers = new Map<ts.Symbol, string | undefined>();

    /** One reported read, whichever kind of cached reader found it. */
    const report = (node: ts.Node, reader: CachedReadOfAPlainFieldIssue["reader"], named: string): void => {
      const reads = readsIn(node, cls, declaring, resolve, writers);
      for (const field of reads.fields) {
        const writer = writtenBy.get(field);
        if (writer === undefined) continue;
        found.push({
          component: self.name,
          reader,
          named,
          field,
          variable: false,
          writtenBy: writer,
          ...positionOf(node),
        });
      }
      for (const { name: variable, writer } of reads.variables.values()) {
        found.push({
          component: self.name,
          reader,
          named,
          field: variable,
          variable: true,
          writtenBy: writer,
          ...positionOf(node),
        });
      }
    };

    for (const member of cls.members) {
      if (hasDecorator(member, "compute", resolve)) {
        const named = memberName(member);
        if (named !== undefined) report(member, "a `@compute`", named);
        continue;
      }

      /**
       * `x = this.use(Hook, () => ({ … }))` — the SECOND argument, which is the props callback.
       *
       * Written there, or NAMED there: `this.use(Hook, makeProps)` is the same callback declared
       * somewhere else, and whoever writes it should not have to know that the inline spelling is
       * the one this reads. A name this program declares is followed to its function; a method of
       * the class, `this.use(Hook, this.build)`, to its body. A value it cannot name — a parameter,
       * a library's function — is not known here. A plain object rather than a callback is a
       * different fault with its own report (`RMD055`, which the types refuse anyway).
       */
      if (!ts.isPropertyDeclaration(member) || member.initializer === undefined) continue;
      const call = member.initializer;
      if (!ts.isCallExpression(call) || !isThisUse(call)) continue;

      const factory = propsCallback(call.arguments[1], declaring, resolve);
      if (factory === undefined) continue;

      const named = memberName(member);
      if (named !== undefined) report(factory, "a props callback", named);
    }

    return found;
  },
} as const satisfies Rule<CachedReadOfAPlainFieldIssue>;
