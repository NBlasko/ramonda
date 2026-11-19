import ts from "typescript";
import {
  callbackOwner,
  contains,
  isHandedOver,
  isLocalRead,
  isStatic,
  isThisUse,
  memberName,
  positionOf,
  writesUnder,
} from "../syntax";
import { hasDecorator, heritage, runsNow } from "./render-reach";
// The field judgement itself, shared with `row-reads-a-plain-field`: which fields a CACHED reader
// can go stale on, and which writes count. See `stale-field.ts` for why it is not written twice.
import { type FieldWrite, fieldWrites, runsIn } from "./stale-field";
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
 * one. Their own writes, that is: a function written INSIDE one of them — a listener the constructor
 * adds, a timer `@created` starts — runs later, and its writes count (see `runsByTheFirstRender`).
 * Anywhere else, any function holding a write is a later place, even one invoked on the spot: which
 * functions run when is not followed.
 *
 * **A write from inside a render or a `@compute`** — the memo pattern,
 * `if (!this.cache) this.cache = expensive()`. A render's own writes, again: a handler it writes,
 * `onclick={() => { this.rate = 3 }}`, runs on a click, and its write counts. Advising `@state` there would be advising a loop.
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
  /** A script's global no file in view writes — any script may: `writtenBy` then names nobody. */
  global: boolean;
  /** A `let` or `var` declared outside the class rather than a field of it. */
  variable: boolean;
  /** The member or function that writes it, which is what makes it stale. */
  writtenBy: string;
  file: string;
  line: number;
  column: number;
}

/** One write that can leave a cached reader stale — see `FieldWrite` — or a script's global with no writer in view. */
interface Write extends FieldWrite {
  /** A script's global with no writer in view — any script may write it. */
  global?: true;
}

/** What a cached reader reads that something may write later. */
interface Reads {
  /** Every `this.X` read, by name — the caller keeps the ones something writes later. */
  fields: Set<string>;
  /** A `let` or `var` declared outside the reader → its name and declaration. */
  variables: Map<ts.Symbol, { name: string; declaration: ts.VariableDeclaration }>;
}

/** The name a report gives the function a write is in — a method, a function, or neither. */
function writerName(node: ts.Node): string {
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    if ((ts.isFunctionDeclaration(at) || ts.isMethodDeclaration(at) || ts.isAccessor(at)) && at.name !== undefined)
      return at.name.getText();
    if (ts.isVariableDeclaration(at) && ts.isIdentifier(at.name)) return at.name.text;
    // A static field is not something anyone calls: the function around its class is.
    if (ts.isPropertyAssignment(at) || (ts.isPropertyDeclaration(at) && !isStatic(at))) return at.name.getText();
    if (ts.isCallExpression(at) && ts.isIdentifier(at.expression))
      return `a callback given to \`${at.expression.text}\``;
  }
  return `a function at the top level of ${node.getSourceFile().fileName.split("/").pop()}`;
}

/** The members of that name in the nearest class up the chain — the one an instance has. */
function nearestMembers(declaring: readonly ts.ClassLikeDeclaration[], name: string): ts.ClassElement[] {
  for (const one of declaring) {
    const found = one.members.filter((member) => memberName(member) === name);
    if (found.length > 0) return found;
  }
  return [];
}

/** Whether a write runs in the function that makes `cls` — over before any instance of it exists. */
function madeTooEarly(write: Write, cls: ts.ClassLikeDeclaration): boolean {
  return contains(write.fn, cls);
}

/** The writes of each file, by variable — per program, because the symbols are one checker's. */
const writesInFile = new WeakMap<Resolver, WeakMap<ts.SourceFile, Map<ts.Symbol, Write[]>>>();

/**
 * Every write to a `let` or `var` that runs in a function or an instance field's initializer — a write
 * made while the module is first evaluated does not count, one inside a function does, even a function
 * invoked then. Collected once per file for the whole program, since nothing in the answer depends on
 * who reads it. Only the declaring
 * file is read, and for a module that is complete rather than a shortcut: an imported binding is
 * read-only in every module but its own, so no other file can assign it. A script's top-level one is a
 * GLOBAL, which any other script can assign: with no writer in this file, it is still counted as
 * written, and reported as a global.
 */
function variableWrites(declaration: ts.VariableDeclaration, symbol: ts.Symbol, resolve: Resolver): Write[] {
  const file = declaration.getSourceFile();
  // One pass per file, every variable's writes at once: a file read once for each variable in it cost
  // a whole traversal per `let`.
  let ofProgram = writesInFile.get(resolve);
  if (ofProgram === undefined) {
    ofProgram = new WeakMap();
    writesInFile.set(resolve, ofProgram);
  }
  let bySymbol = ofProgram.get(file);
  if (bySymbol === undefined) {
    const found = new Map<ts.Symbol, Write[]>();
    writesUnder(file, false, (target) => {
      if (!ts.isIdentifier(target)) return;
      const written = resolve(target);
      const fn = runsIn(target);
      if (written === undefined || fn === undefined) return;
      const list = found.get(written) ?? [];
      list.push({ writer: writerName(target), fn });
      found.set(written, list);
    });
    bySymbol = found;
    ofProgram.set(file, bySymbol);
  }
  const writes = bySymbol.get(symbol) ?? [];
  // A top-level `let` in a file with no import or export is a GLOBAL, which any other script can assign
  // and no single file says where: with no writer in view, it is still counted as written.
  const global =
    !ts.isExternalModule(file) &&
    ts.isVariableStatement(declaration.parent.parent) &&
    declaration.parent.parent.parent === file;
  return global && writes.length === 0 ? [{ writer: "any script", fn: declaration, global: true }] : writes;
}

/** A `let` or `var` this identifier reads, when it is not local to what the reader runs (see `local`). */
function outerVariable(
  id: ts.Identifier,
  local: (declaration: ts.Node) => boolean,
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
  // Declared in a function the reader runs — a local of that call — or in the class or a base: neither is
  // outside it, and a local written inside its own function is just a local.
  if (local(declaration)) return undefined;
  return { declaration, symbol };
}

/**
 * Everything a cached reader reads that can go stale — wherever the reading happens.
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
 * on the spot is (`runsNow`). Bounded and cycle-guarded.
 *
 * **That is a closed list**, and on purpose (TODO 184). What a getter RETURNS when it is called, a field
 * holding a function, a library's or the platform's function: none is followed, and what they read is not
 * known here. Following "what a function reads" further found new shapes in every review round, each
 * fix with neighbours of its own; which of those shapes to follow, to forbid, or to mark unknown in the
 * Ramonda graph is decided shape by shape, toward one way of writing each thing.
 */
function readsIn(node: ts.Node, declaring: readonly ts.ClassLikeDeclaration[], resolve: Resolver): Reads {
  const reads: Reads = { fields: new Set(), variables: new Map() };
  // A props callback names its owner as `this`, its parameter, or the parameter destructured — see
  // `callbackOwner`. A method the walk follows into has only `this`, and a free function none.
  const rootOwner = callbackOwner(node, resolve);
  const seen = new Set<ts.Node>();
  /**
   * A declaration local to what the reader runs: inside it, or inside a body it walks — a method's, a
   * base method's, a function's it calls. A local is only ever read by walking the body that holds it.
   */
  const local = (declaration: ts.Node): boolean =>
    contains(node, declaration) || [...seen].some((body) => contains(body, declaration));

  const plainGetter = (member: ts.ClassElement): member is ts.GetAccessorDeclaration =>
    ts.isGetAccessorDeclaration(member) && !hasDecorator(member, "compute", resolve) && member.body !== undefined;

  const walk = (at: ts.Node, depth: number, hasThis: boolean): void => {
    if (depth > 6 || seen.has(at)) return;
    seen.add(at);

    /**
     * Runs what reading or calling a member runs, and says whether it is a member that runs at all: a
     * GETTER's own body when it is read, a METHOD's when it is called or handed to a call (`.map(this.format)`,
     * see `runsNow`) — bound to the instance by the framework. That is the whole list (TODO 184): what a
     * getter RETURNS is not followed, nor a field holding a function (`arrow-fields` refuses those).
     */
    const follow = (member: ts.ClassElement, runs: boolean): boolean => {
      if (plainGetter(member)) {
        walk(member, depth + 1, true);
        return true;
      }
      if (!ts.isMethodDeclaration(member)) return false;
      if (runs && member.body !== undefined) walk(member.body, depth + 1, true);
      return true;
    };

    // The root callback's owner — `this`, its `self` parameter, its destructured names — is in scope
    // anywhere written inside it, so an arrow there called a line later reads `self` as the owner too.
    // Matched by the binding a name resolves to, never by its text: an inner `(self) => self.rate` is
    // somebody else's `self`.
    const owner = at === node || contains(node, at) ? rootOwner : callbackOwner(at, resolve);
    (function look(current: ts.Node): void {
      if (current !== at) {
        // Built, not run: a function returned, stored or handed over in an object, or an accessor of one.
        if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current)) && !runsNow(current)) return;
        if (isHandedOver(current)) return;
        if (ts.isAccessor(current) && ts.isObjectLiteralExpression(current.parent)) return;
      }
      if (ts.isIdentifier(current)) {
        const destructured = hasThis && isLocalRead(current) ? owner.member(current) : undefined;
        if (destructured !== undefined) {
          const name = destructured;
          // Methods are bound to the instance, so a destructured one runs as `self.priced()` would.
          let followed = false;
          for (const member of nearestMembers(declaring, name))
            followed = follow(member, runsWhere(current)) || followed;
          if (!followed) reads.fields.add(name);
        }
        const outer = outerVariable(current, local, resolve);
        if (outer !== undefined) {
          if (!reads.variables.has(outer.symbol))
            reads.variables.set(outer.symbol, { name: current.text, declaration: outer.declaration });
        }
      }
      if (
        hasThis &&
        ts.isPropertyAccessExpression(current) &&
        owner.is(current.expression) &&
        ts.isIdentifier(current.name)
      ) {
        const name = current.name.text;
        let followed = false;
        for (const member of nearestMembers(declaring, name)) followed = follow(member, runsWhere(current)) || followed;
        if (!followed) reads.fields.add(name);
      }
      if (ts.isCallExpression(current) && ts.isIdentifier(current.expression)) {
        const fn = projectFunction(current.expression, resolve);
        // An arrow's `this` is the one where it is WRITTEN, whoever calls it: an arrow written in a member
        // of this class keeps the instance's — `const price = (n) => n * this.rate` in a compute, called a
        // line later, or from a nested `function`. A `function`, or an arrow written anywhere else, has none.
        if (fn?.body !== undefined) walk(fn.body, depth + 1, arrowSeesTheInstance(fn, declaring));
      }
      ts.forEachChild(current, look);
    })(at);
  };

  walk(node, 0, true);
  return reads;
}

/** Whether what this expression names runs here: it is called, or handed to a call, which runs it. */
function runsWhere(expression: ts.Expression): boolean {
  const parent = expression.parent;
  return ts.isCallExpression(parent) && (parent.expression === expression || parent.arguments.includes(expression));
}

/**
 * The function a name stands for, when this program declares it — or `undefined`. Of an overloaded one,
 * the implementation: the signatures before it have no body to run.
 */
function projectFunction(name: ts.Expression, resolve: Resolver): ts.FunctionLikeDeclaration | undefined {
  for (const declaration of resolve(name)?.declarations ?? []) {
    const file = declaration.getSourceFile();
    if (file.isDeclarationFile || file.fileName.includes("node_modules")) return undefined;
    if (ts.isFunctionDeclaration(declaration) && declaration.body !== undefined) return declaration;
    if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
      const value = declaration.initializer;
      if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return value;
    }
  }
  return undefined;
}

/**
 * Whether an arrow's `this` is the instance: the nearest function around it that is not an arrow is a
 * member of the class or a base — a method, an accessor, the constructor — or it sits in an instance field's
 * initializer. An arrow takes `this` from where it is written, never from its caller.
 */
function arrowSeesTheInstance(fn: ts.FunctionLikeDeclaration, declaring: readonly ts.ClassLikeDeclaration[]): boolean {
  if (!ts.isArrowFunction(fn)) return false;
  // The class or one of its bases: a base's method runs on this instance too.
  const ownOrInherited = (parent: ts.Node): boolean => declaring.some((one) => one === parent);
  for (let at: ts.Node | undefined = fn.parent; at !== undefined; at = at.parent) {
    if (ts.isArrowFunction(at)) continue;
    if (ts.isPropertyDeclaration(at)) return ownOrInherited(at.parent) && !isStatic(at);
    if (ts.isFunctionLike(at)) {
      const member = ts.isMethodDeclaration(at) || ts.isAccessor(at) || ts.isConstructorDeclaration(at);
      return member && ownOrInherited(at.parent) && !isStatic(at);
    }
  }
  return false;
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
    // The nearest declaration of that name — the one an instance has — and of an overloaded method, the
    // implementation, the one with a body. A field holding a function is `arrow-fields`' to refuse.
    const name = argument.name.text;
    return nearestMembers(declaring, name).find(
      (each): each is ts.MethodDeclaration => ts.isMethodDeclaration(each) && each.body !== undefined,
    );
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
      issue.global
        ? `    <${issue.component}>'s \`${issue.named}\` — ${issue.reader} — reads the global \`${issue.field}\`, ` +
          "which any script may write, and that invalidates nothing."
        : `    <${issue.component}>'s \`${issue.named}\` — ${issue.reader} — reads ` +
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
      "A lazy first value — `this.fmt ??= new Intl.NumberFormat()` — is a write like any other: a reader\n" +
      "that read the slot before it was filled keeps what it read. A value made once belongs in a module\n" +
      "constant (`const FMT = new Intl.NumberFormat()`), or in a `@compute` when it depends on state.\n\n" +
      "A field nothing writes after the first render is NOT reported — a constant a compute reads\n" +
      "can never go stale, and neither can one written in the constructor or `@created`.\n\n",
  },

  read(cls, { self, resolve }) {
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
      const reads = readsIn(node, declaring, resolve);
      for (const field of reads.fields) {
        const writer = writesTo.get(field)?.[0]?.writer;
        if (writer === undefined) continue;
        found.push({
          component: self.name,
          reader,
          named,
          field,
          variable: false,
          global: false,
          writtenBy: writer,
          ...positionOf(node),
        });
      }
      for (const [symbol, read] of reads.variables) {
        const writes = variableWrites(read.declaration, symbol, resolve).filter((write) => !madeTooEarly(write, cls));
        const write = writes[0];
        if (write === undefined) continue;
        found.push({
          component: self.name,
          reader,
          named,
          field: read.name,
          variable: true,
          global: write.global === true,
          writtenBy: write.writer,
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
