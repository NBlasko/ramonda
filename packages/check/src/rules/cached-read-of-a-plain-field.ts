import ts from "typescript";
import { callbackOwner, isHandedOver, isLocalRead, isThisUse, memberName, positionOf } from "../syntax";
import { hasDecorator, heritage, memberBody, runsNow } from "./render-reach";
// The field judgement itself, shared with `row-reads-a-plain-field`: which fields a CACHED reader
// can go stale on, and which writes count. See `stale-field.ts` for why it is not written twice.
import { trackedOrHarmless, writesAfterTheFirstRender } from "./stale-field";
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

/** One write that can leave a cached reader stale: who makes it, where it runs, and whether it is lazy. */
interface Write {
  writer: string;
  /** The body it runs in — matched against the bodies a reader walks. */
  scope: ts.Node;
  /** A lazy first value — `??=`, `||=`, `if (!x) x = …` — which only the reader that makes it may ignore. */
  lazy: boolean;
}

/** What a cached reader reads, and in which body — the place decides whether a lazy write can be ignored. */
interface Reads {
  /** Every `this.X` read, by name → the bodies it was read in. */
  fields: Map<string, Set<ts.Node>>;
  /** A `let` or `var` declared outside the reader → its name, and the bodies it was read in. */
  variables: Map<ts.Symbol, { name: string; declaration: ts.VariableDeclaration; scopes: Set<ts.Node> }>;
  /** Every body the reader walked. */
  walked: Set<ts.Node>;
}

/** The name a report gives the function a write is in — a method, a function, or neither. */
function writerName(node: ts.Node): string {
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    if ((ts.isFunctionDeclaration(at) || ts.isMethodDeclaration(at) || ts.isAccessor(at)) && at.name !== undefined)
      return at.name.getText();
    if (ts.isVariableDeclaration(at) && ts.isIdentifier(at.name)) return at.name.text;
    if (ts.isPropertyAssignment(at) || ts.isPropertyDeclaration(at)) return at.name.getText();
    if (ts.isCallExpression(at) && ts.isIdentifier(at.expression))
      return `a callback given to \`${at.expression.text}\``;
  }
  return "a function";
}

/** A function's body when it has one, so a reader's walk and a write's place are named alike. */
function bodyOf(node: ts.Node): ts.Node {
  return ts.isFunctionLike(node) && "body" in node && node.body !== undefined ? (node.body as ts.Node) : node;
}

function isStatic(member: ts.Node): boolean {
  return (
    ts.canHaveModifiers(member) &&
    ts.getModifiers(member)?.some((one) => one.kind === ts.SyntaxKind.StaticKeyword) === true
  );
}

/**
 * The body a write runs in — or `undefined` for one that is over before any instance can read it: while
 * the module is first evaluated, in a static block or a static field, or in the function that makes the
 * class (a class declared in a factory). An instance field's initializer runs once per instance, so it
 * is a place of its own.
 */
function runScope(node: ts.Node, cls: ts.ClassLikeDeclaration): ts.Node | undefined {
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    if (ts.isClassStaticBlockDeclaration(at)) return undefined;
    if (ts.isPropertyDeclaration(at)) return isStatic(at) ? undefined : at;
    if (ts.isFunctionLike(at)) {
      const makesTheClass = at.getSourceFile() === cls.getSourceFile() && cls.pos >= at.pos && cls.end <= at.end;
      return makesTheClass ? undefined : bodyOf(at);
    }
  }
  return undefined;
}

/** Every identifier or `this.X` an assignment's left side writes, through any destructuring. */
function targetsOf(left: ts.Node, into: ts.Expression[]): void {
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
    // `[a = 1] = list` — a default inside a pattern.
    targetsOf(left.left, into);
  }
}

/** Every write under a node — the target and, for an assignment, the assignment. */
function writesUnder(
  root: ts.Node,
  visit: (target: ts.Expression, write: ts.BinaryExpression | undefined) => void,
): void {
  (function walk(at: ts.Node): void {
    const targets: ts.Expression[] = [];
    let write: ts.BinaryExpression | undefined;
    if (
      ts.isBinaryExpression(at) &&
      at.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      at.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      targetsOf(at.left, targets);
      write = at;
    } else if (
      (ts.isPostfixUnaryExpression(at) || ts.isPrefixUnaryExpression(at)) &&
      (at.operator === ts.SyntaxKind.PlusPlusToken || at.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      targetsOf(at.operand, targets);
    } else if ((ts.isForOfStatement(at) || ts.isForInStatement(at)) && !ts.isVariableDeclarationList(at.initializer)) {
      targetsOf(at.initializer, targets);
    }
    for (const target of targets) visit(target, write);
    ts.forEachChild(at, walk);
  })(root);
}

/**
 * Whether a write is a LAZY first value — `x ??= make()`, `x ||= make()`, or `if (!x) x = make()`. It
 * fills an empty slot once; it still changes what a reader that read the empty slot first holds, so it
 * is ignored only for the reader that makes it itself (see `staleWriter`).
 */
function isLazy(write: ts.BinaryExpression, isIt: (node: ts.Expression) => boolean): boolean {
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
 * The writes to a `let` or `var` that can come after the class reading it exists. Only the declaring
 * file is read, and that is complete rather than a shortcut: an imported binding is read-only in every
 * module but its own, so no other file can assign it.
 */
function variableWrites(
  declaration: ts.VariableDeclaration,
  symbol: ts.Symbol,
  cls: ts.ClassLikeDeclaration,
  resolve: Resolver,
): Write[] {
  const writes: Write[] = [];
  const isIt = (node: ts.Expression): boolean => ts.isIdentifier(node) && resolve(node) === symbol;
  writesUnder(declaration.getSourceFile(), (target, write) => {
    if (!isIt(target)) return;
    const scope = runScope(target, cls);
    if (scope === undefined) return;
    writes.push({ writer: writerName(target), scope, lazy: write !== undefined && isLazy(write, isIt) });
  });
  return writes;
}

/**
 * The writes to this class's ordinary fields that can come after the first render, by field — the
 * same fields and the same members `staleFieldsOf` judges, with where each write runs and whether it
 * is lazy.
 */
function fieldWrites(
  declaring: readonly ts.ClassLikeDeclaration[],
  cls: ts.ClassLikeDeclaration,
  resolve: Resolver,
): Map<string, Write[]> {
  const plain = new Set<string>();
  for (const one of declaring) {
    for (const member of one.members) {
      if (!ts.isPropertyDeclaration(member) || trackedOrHarmless(member, resolve)) continue;
      const name = memberName(member);
      if (name !== undefined) plain.add(name);
    }
  }
  const writes = new Map<string, Write[]>();
  if (plain.size === 0) return writes;
  for (const one of declaring) {
    for (const member of one.members) {
      if (!writesAfterTheFirstRender(member, resolve)) continue;
      const writer = memberName(member) ?? "a method";
      writesUnder(member, (target, write) => {
        if (
          !ts.isPropertyAccessExpression(target) ||
          target.expression.kind !== ts.SyntaxKind.ThisKeyword ||
          !plain.has(target.name.text)
        )
          return;
        const field = target.name.text;
        const scope = runScope(target, cls);
        if (scope === undefined) return;
        const isIt = (node: ts.Expression): boolean =>
          ts.isPropertyAccessExpression(node) &&
          node.expression.kind === ts.SyntaxKind.ThisKeyword &&
          node.name.text === field;
        const list = writes.get(field) ?? [];
        list.push({ writer, scope, lazy: write !== undefined && isLazy(write, isIt) });
        writes.set(field, list);
      });
    }
  }
  return writes;
}

/**
 * The first write that leaves this reader stale, by its writer — or `undefined`.
 *
 * A lazy first value is ignored only when the reader makes it itself and reads the slot nowhere else:
 * `money()` filling `fmt ??= …` and then formatting with it, a getter returning `this._api ??= create()`.
 * Read anywhere else first, the reader holds what the empty slot gave it — `@compute get show() {
 * return !dismissed }` with `dismissed ||= true` in a handler is as stale as any other write.
 */
function staleWriter(
  writes: readonly Write[],
  readIn: ReadonlySet<ts.Node>,
  walked: ReadonlySet<ts.Node>,
): string | undefined {
  for (const write of writes) {
    const madeByTheReader =
      write.lazy && walked.has(write.scope) && [...readIn].every((scope) => scope === write.scope);
    if (!madeByTheReader) return write.writer;
  }
  return undefined;
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
 * Everything a cached reader reads that can go stale — wherever the reading happens, and in which body.
 *
 * A CALL through `this` is a method, and the method is FOLLOWED: `@compute get total() { return
 * this.priced() }`, where `priced()` reads a plain `rate`, caches exactly the stale answer a direct
 * read would — the compute tracks the signals read while it evaluated, wherever they were read.
 * Reading only the compute's own body reported the version somebody writes on their first day and
 * missed the version that ships. Measured with a plant.
 *
 * A GETTER read through `this`, or destructured from the owner, is followed the same way, because
 * reading it runs it; a `@compute` getter is not, because it is a signal. A call to a FUNCTION this
 * program declares is followed too — it has no `this` of the component's, but it can read a module's
 * `let`, and that goes stale in exactly the same way.
 *
 * A function the reader only BUILDS — returned, stored, handed over in an object — does not run while
 * it reads, so it is not walked; one passed to a call or invoked on the spot is (`runsNow`). Bounded and
 * cycle-guarded. A function the program does not declare — a library's, the platform's — is not
 * followed, and what it reads is not known here.
 */
function readsIn(
  node: ts.Node,
  cls: ts.ClassLikeDeclaration,
  declaring: readonly ts.ClassLikeDeclaration[],
  resolve: Resolver,
): Reads {
  const reads: Reads = { fields: new Map(), variables: new Map(), walked: new Set() };
  // A props callback names its owner as `this`, its parameter, or the parameter destructured — see
  // `callbackOwner`. A method the walk follows into has only `this`, and a free function none.
  const callback = callbackOwner(node);
  const seen = new Set<ts.Node>();

  const memberNamed = (name: string): ts.ClassElement[] =>
    declaring.flatMap((one) => one.members.filter((member) => memberName(member) === name));
  const plainGetter = (member: ts.ClassElement): member is ts.GetAccessorDeclaration =>
    ts.isGetAccessorDeclaration(member) && !hasDecorator(member, "compute", resolve) && member.body !== undefined;
  const readField = (name: string, scope: ts.Node): void => {
    const scopes = reads.fields.get(name) ?? new Set<ts.Node>();
    scopes.add(scope);
    reads.fields.set(name, scopes);
  };

  const walk = (at: ts.Node, depth: number, hasThis: boolean): void => {
    if (depth > 6 || seen.has(at)) return;
    seen.add(at);
    const scope = bodyOf(at);
    reads.walked.add(scope);

    const owner = at === node ? callback : callbackOwner(at);
    (function look(current: ts.Node): void {
      if (current !== at) {
        // Built, not run: a function returned, stored or handed over in an object.
        if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current)) && !runsNow(current)) return;
        if (isHandedOver(current)) return;
      }
      if (ts.isIdentifier(current)) {
        if (hasThis && owner.destructured.has(current.text) && isLocalRead(current)) {
          const name = owner.destructured.get(current.text) as string;
          const getters = memberNamed(name).filter(plainGetter);
          for (const getter of getters) walk(getter, depth + 1, true);
          if (getters.length === 0) readField(name, scope);
        }
        const outer = outerVariable(current, at === node ? node : (at.parent ?? at), cls, resolve);
        if (outer !== undefined) {
          const known = reads.variables.get(outer.symbol);
          if (known !== undefined) known.scopes.add(scope);
          else
            reads.variables.set(outer.symbol, {
              name: current.text,
              declaration: outer.declaration,
              scopes: new Set([scope]),
            });
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
          } else if (plainGetter(member)) {
            walk(member, depth + 1, true);
            followed = true;
          }
        }
        if (!called && !followed) readField(name, scope);
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
    /** This class and its bases — what a `this.method()` hop out of a cached reader can land in. */
    const declaring = [cls, ...heritage(cls, resolve)];
    /**
     * field → its writes after the first render. `resolve` reaches the BASES as well: a plain field on a
     * shared base is this component's field, and goes stale in exactly the same way.
     */
    const writesTo = fieldWrites(declaring, cls, resolve);

    const found: CachedReadOfAPlainFieldIssue[] = [];
    /** Each outer variable's writes, asked once for the class: every read would otherwise walk its file again. */
    const variableWritesOf = new Map<ts.Symbol, Write[]>();

    /** One reported read, whichever kind of cached reader found it. */
    const report = (node: ts.Node, reader: CachedReadOfAPlainFieldIssue["reader"], named: string): void => {
      const reads = readsIn(node, cls, declaring, resolve);
      for (const [field, readIn] of reads.fields) {
        const writer = staleWriter(writesTo.get(field) ?? [], readIn, reads.walked);
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
      for (const [symbol, read] of reads.variables) {
        let writes = variableWritesOf.get(symbol);
        if (writes === undefined) {
          writes = variableWrites(read.declaration, symbol, cls, resolve);
          variableWritesOf.set(symbol, writes);
        }
        const writer = staleWriter(writes, read.scopes, reads.walked);
        if (writer === undefined) continue;
        found.push({
          component: self.name,
          reader,
          named,
          field: read.name,
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
