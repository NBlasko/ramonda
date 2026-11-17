import ts from "typescript";
import { callbackOwner, isHandedOver, isLocalRead, isThisUse, memberName, positionOf, targetsOf } from "../syntax";
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
  /** The function holding it, when that is not `scope` itself — a class made inside it is made by it. */
  fn: ts.Node;
  /** A lazy first value — `??=`, `||=`, `if (!x) x = …` — which only a reader filling it itself may ignore. */
  lazy: boolean;
  /** Where the write is, to tell whether a body fills the slot before it reads it. */
  pos: number;
}

/** What a cached reader reads, and where — the place decides whether a lazy write can be ignored. */
interface Reads {
  /** Every `this.X` read, by name → each body it was read in, with its first read there. */
  fields: Map<string, Map<ts.Node, number>>;
  /** A `let` or `var` declared outside the reader → its name, and each body it was read in. */
  variables: Map<ts.Symbol, { name: string; declaration: ts.VariableDeclaration; first: Map<ts.Node, number> }>;
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

/** A node with a `this` of its own: a nested class, a `function`, a method or accessor of an object literal. */
function bindsThis(node: ts.Node): boolean {
  return (
    ts.isClassDeclaration(node) ||
    ts.isClassExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ((ts.isMethodDeclaration(node) || ts.isAccessor(node)) && ts.isObjectLiteralExpression(node.parent))
  );
}

/**
 * Where a write runs — its body and the function holding it — or `undefined` for one that is over before
 * any instance exists: while the module is first evaluated, or in a static block or static field. An
 * instance field's initializer runs once per instance, so it is a place of its own. Whether the function
 * holding it MAKES the class reading it (a class declared in a factory) is the reader's question, asked
 * in `madeTooEarly`.
 */
function placeOf(node: ts.Node): { scope: ts.Node; fn: ts.Node } | undefined {
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    if (ts.isClassStaticBlockDeclaration(at)) return undefined;
    if (ts.isPropertyDeclaration(at)) return isStatic(at) ? undefined : { scope: at, fn: at };
    if (ts.isFunctionLike(at)) return { scope: bodyOf(at), fn: at };
  }
  return undefined;
}

/** Whether a write runs in the function that makes `cls` — over before any instance of it exists. */
function madeTooEarly(write: Write, cls: ts.ClassLikeDeclaration): boolean {
  return write.fn.getSourceFile() === cls.getSourceFile() && cls.pos >= write.fn.pos && cls.end <= write.fn.end;
}

/** Every write under a node — its target and, for an assignment, the assignment — `this` kept bound if asked. */
function writesUnder(
  root: ts.Node,
  keepThis: boolean,
  visit: (target: ts.Expression, write: ts.BinaryExpression | undefined) => void,
): void {
  (function walk(at: ts.Node): void {
    if (keepThis && at !== root && bindsThis(at)) return;
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
 * Where a LAZY first value begins — `x ??= make()`, `x ||= make()`, or `if (!x) x = make()` — or
 * `undefined` for a write that is not one. It
 * fills an empty slot once; it still changes what a reader that read the empty slot first holds, so it
 * is ignored only for a reader that fills it itself before every read (see `staleWriter`).
 */
function lazyFrom(write: ts.BinaryExpression, isIt: (node: ts.Expression) => boolean): number | undefined {
  const operator = write.operatorToken.kind;
  if (operator === ts.SyntaxKind.QuestionQuestionEqualsToken || operator === ts.SyntaxKind.BarBarEqualsToken)
    return write.left.getStart();
  if (operator !== ts.SyntaxKind.EqualsToken) return undefined;
  let statement: ts.Node = write.parent;
  if (!ts.isExpressionStatement(statement)) return undefined;
  if (ts.isBlock(statement.parent) && statement.parent.statements.length === 1) statement = statement.parent;
  const guard = statement.parent;
  if (!ts.isIfStatement(guard) || guard.thenStatement !== statement) return undefined;
  const tested = guard.expression;
  // From the `if`: its test reads the slot, and that read is the memo asking whether to fill it.
  if (ts.isPrefixUnaryExpression(tested) && tested.operator === ts.SyntaxKind.ExclamationToken)
    return isIt(tested.operand) ? guard.getStart() : undefined;
  if (ts.isBinaryExpression(tested)) {
    const empty = (node: ts.Expression): boolean =>
      node.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(node) && node.text === "undefined");
    const kind = tested.operatorToken.kind;
    if (kind !== ts.SyntaxKind.EqualsEqualsEqualsToken && kind !== ts.SyntaxKind.EqualsEqualsToken) return undefined;
    const guarded = (isIt(tested.left) && empty(tested.right)) || (isIt(tested.right) && empty(tested.left));
    return guarded ? guard.getStart() : undefined;
  }
  return undefined;
}

/**
 * Every write to a `let` or `var` that runs after its module was first evaluated — asked once per
 * variable for the whole program, since nothing in the answer depends on who reads it. Only the
 * declaring file is read, and that is complete rather than a shortcut: an imported binding is read-only
 * in every module but its own, so no other file can assign it.
 */
const writesOfVariable = new WeakMap<ts.VariableDeclaration, Write[]>();
function variableWrites(declaration: ts.VariableDeclaration, symbol: ts.Symbol, resolve: Resolver): Write[] {
  const known = writesOfVariable.get(declaration);
  if (known !== undefined) return known;
  const writes: Write[] = [];
  const isIt = (node: ts.Expression): boolean => ts.isIdentifier(node) && resolve(node) === symbol;
  writesUnder(declaration.getSourceFile(), false, (target, write) => {
    if (!isIt(target)) return;
    const place = placeOf(target);
    if (place === undefined) return;
    const from = write === undefined ? undefined : lazyFrom(write, isIt);
    writes.push({ writer: writerName(target), ...place, lazy: from !== undefined, pos: from ?? target.getStart() });
  });
  writesOfVariable.set(declaration, writes);
  return writes;
}

/**
 * The writes to this class's ordinary fields that can come after the first render, by field — the
 * same fields and the same members `staleFieldsOf` judges, with where each write runs and whether it
 * is lazy. A static member's `this` is the class, and a nested `function`'s is its own: neither writes
 * an instance field.
 */
function fieldWrites(declaring: readonly ts.ClassLikeDeclaration[], resolve: Resolver): Map<string, Write[]> {
  const plain = new Set<string>();
  for (const one of declaring) {
    for (const member of one.members) {
      if (!ts.isPropertyDeclaration(member) || isStatic(member) || trackedOrHarmless(member, resolve)) continue;
      const name = memberName(member);
      if (name !== undefined) plain.add(name);
    }
  }
  const writes = new Map<string, Write[]>();
  if (plain.size === 0) return writes;
  for (const one of declaring) {
    for (const member of one.members) {
      if (isStatic(member) || ts.isClassStaticBlockDeclaration(member)) continue;
      if (!writesAfterTheFirstRender(member, resolve)) continue;
      const writer = memberName(member) ?? "a method";
      writesUnder(member, true, (target, write) => {
        if (
          !ts.isPropertyAccessExpression(target) ||
          target.expression.kind !== ts.SyntaxKind.ThisKeyword ||
          !plain.has(target.name.text)
        )
          return;
        const field = target.name.text;
        const place = placeOf(target);
        if (place === undefined) return;
        const isIt = (node: ts.Expression): boolean =>
          ts.isPropertyAccessExpression(node) &&
          node.expression.kind === ts.SyntaxKind.ThisKeyword &&
          node.name.text === field;
        const list = writes.get(field) ?? [];
        const from = write === undefined ? undefined : lazyFrom(write, isIt);
        list.push({ writer, ...place, lazy: from !== undefined, pos: from ?? target.getStart() });
        writes.set(field, list);
      });
    }
  }
  return writes;
}

/**
 * The first write that leaves this reader stale, by its writer — or `undefined`.
 *
 * A lazy first value is ignored only for a self-filling memo: every write to the slot is lazy, and every
 * body this reader reads it in fills it first — `money()` and `pct()` each doing `fmt ??= …` before
 * formatting, a getter returning `this._api ??= create()`. Such a reader never sees the slot empty, and a
 * slot filled once is never changed again, by whichever body filled it. A slot read anywhere else holds
 * what the empty slot gave it: `@compute get show() { return !dismissed }` with `dismissed ||= true` in a
 * handler is as stale as any other write.
 */
function staleWriter(writes: readonly Write[], first: ReadonlyMap<ts.Node, number>): string | undefined {
  if (writes.length === 0) return undefined;
  for (const write of writes) {
    if (!write.lazy) return write.writer;
  }
  for (const [scope, at] of first) {
    if (!writes.some((write) => write.scope === scope && write.pos <= at)) return writes[0].writer;
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
 * missed the version that ships. Measured with a plant. The member that runs is the NEAREST one up the
 * chain: a base's method a subclass overrides is never run.
 *
 * A GETTER read through `this`, or destructured from the owner, is followed the same way, because
 * reading it runs it, and so is a destructured method that is called; a `@compute` getter is not,
 * because it is a signal. A call to a FUNCTION this program declares is followed too — it has no `this`
 * of the component's, but it can read a module's `let`, and that goes stale in exactly the same way.
 *
 * A function the reader only BUILDS — returned, stored, handed over in an object, an accessor of an
 * object it returns — does not run while it reads, so it is not walked; one passed to a call or invoked
 * on the spot is (`runsNow`), and its body is a place of its own. Bounded and cycle-guarded. A function
 * the program does not declare — a library's, the platform's — is not followed, and what it reads is not
 * known here.
 */
function readsIn(
  node: ts.Node,
  cls: ts.ClassLikeDeclaration,
  declaring: readonly ts.ClassLikeDeclaration[],
  resolve: Resolver,
): Reads {
  const reads: Reads = { fields: new Map(), variables: new Map() };
  // A props callback names its owner as `this`, its parameter, or the parameter destructured — see
  // `callbackOwner`. A method the walk follows into has only `this`, and a free function none.
  const callback = callbackOwner(node);
  const seen = new Set<ts.Node>();

  /** The members of that name in the nearest class up the chain — the one that runs. */
  const nearestNamed = (name: string): ts.ClassElement[] => {
    for (const one of declaring) {
      const found = one.members.filter((member) => memberName(member) === name);
      if (found.length > 0) return found;
    }
    return [];
  };
  const plainGetter = (member: ts.ClassElement): member is ts.GetAccessorDeclaration =>
    ts.isGetAccessorDeclaration(member) && !hasDecorator(member, "compute", resolve) && member.body !== undefined;
  const note = (into: Map<ts.Node, number>, scope: ts.Node, at: number): void => {
    const before = into.get(scope);
    if (before === undefined || at < before) into.set(scope, at);
  };

  const walk = (at: ts.Node, depth: number, hasThis: boolean): void => {
    if (depth > 6 || seen.has(at)) return;
    seen.add(at);

    const owner = at === node ? callback : callbackOwner(at);
    (function look(current: ts.Node, scope: ts.Node): void {
      if (current !== at) {
        // Built, not run: a function returned, stored or handed over in an object, or an accessor of one.
        if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
          if (!runsNow(current)) return;
          // Run now, on the spot or by whoever it is handed to: a body of its own, the reader's all the same.
          scope = bodyOf(current);
        }
        if (isHandedOver(current)) return;
        if (ts.isAccessor(current) && ts.isObjectLiteralExpression(current.parent)) return;
      }
      if (ts.isIdentifier(current)) {
        if (hasThis && owner.destructured.has(current.text) && isLocalRead(current)) {
          const name = owner.destructured.get(current.text) as string;
          const members = nearestNamed(name);
          const called = ts.isCallExpression(current.parent) && current.parent.expression === current;
          let followed = false;
          for (const member of members) {
            if (plainGetter(member)) {
              walk(member, depth + 1, true);
              followed = true;
            } else if (ts.isMethodDeclaration(member)) {
              // Methods are bound to the instance, so a destructured one runs as `self.priced()` would.
              if (called && member.body) walk(member.body, depth + 1, true);
              followed = true;
            }
          }
          if (!followed) {
            const scopes = reads.fields.get(name) ?? new Map<ts.Node, number>();
            note(scopes, scope, current.getStart());
            reads.fields.set(name, scopes);
          }
        }
        const outer = outerVariable(current, at === node ? node : (at.parent ?? at), cls, resolve);
        if (outer !== undefined) {
          const known = reads.variables.get(outer.symbol) ?? {
            name: current.text,
            declaration: outer.declaration,
            first: new Map<ts.Node, number>(),
          };
          note(known.first, scope, current.getStart());
          reads.variables.set(outer.symbol, known);
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
        for (const member of nearestNamed(name)) {
          if (called) {
            const body = memberBody(member);
            if (body) walk(body, depth + 1, true);
            followed = true;
          } else if (plainGetter(member)) {
            walk(member, depth + 1, true);
            followed = true;
          }
        }
        if (!called && !followed) {
          const scopes = reads.fields.get(name) ?? new Map<ts.Node, number>();
          note(scopes, scope, current.getStart());
          reads.fields.set(name, scopes);
        }
      }
      if (ts.isCallExpression(current) && ts.isIdentifier(current.expression)) {
        const body = projectFunctionBody(current.expression, resolve);
        if (body !== undefined) walk(body, depth + 1, false);
      }
      ts.forEachChild(current, (child) => look(child, scope));
    })(at, bodyOf(at));
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
    const writesTo = fieldWrites(declaring, resolve);

    const found: CachedReadOfAPlainFieldIssue[] = [];

    /** One reported read, whichever kind of cached reader found it. */
    const report = (node: ts.Node, reader: CachedReadOfAPlainFieldIssue["reader"], named: string): void => {
      const reads = readsIn(node, cls, declaring, resolve);
      for (const [field, first] of reads.fields) {
        const writer = staleWriter(writesTo.get(field) ?? [], first);
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
        const writes = variableWrites(read.declaration, symbol, resolve).filter((write) => !madeTooEarly(write, cls));
        const writer = staleWriter(writes, read.first);
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
