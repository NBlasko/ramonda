import ts from "typescript";
import {
  callbackOwner,
  invokedOnTheSpot,
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

/** One write that can leave a cached reader stale: who makes it, and the function or field it runs in. */
interface Write {
  writer: string;
  /** A script's global with no writer in view — any script may write it. */
  global?: true;
  /** The function holding it — a class made inside that function is made by it. */
  fn: ts.Node;
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
    if (ts.isPropertyAssignment(at) || ts.isPropertyDeclaration(at)) return at.name.getText();
    if (ts.isCallExpression(at) && ts.isIdentifier(at.expression))
      return `a callback given to \`${at.expression.text}\``;
  }
  return "a function";
}

/**
 * The function (or instance field initializer) a write runs in — or `undefined` for one that is over
 * before any instance exists: while the module is first evaluated, or in a static block or static
 * field. An instance field's initializer runs once per instance, so it counts. Whether the function
 * holding it MAKES the class reading it (a class declared in a factory) is the reader's question, asked
 * in `madeTooEarly`.
 */
function runsIn(node: ts.Node): ts.Node | undefined {
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    if (ts.isClassStaticBlockDeclaration(at)) return undefined;
    if (ts.isPropertyDeclaration(at)) return isStatic(at) ? undefined : at;
    // A function invoked on the spot runs where it is written: `(() => { … })()`. Not an async or a
    // generator one, whose body runs on past the call — an assignment after an `await` comes later.
    if (
      (ts.isArrowFunction(at) || ts.isFunctionExpression(at)) &&
      invokedOnTheSpot(at) &&
      at.asteriskToken === undefined &&
      !ts.getModifiers(at)?.some((one) => one.kind === ts.SyntaxKind.AsyncKeyword)
    )
      continue;
    if (ts.isFunctionLike(at)) return at;
  }
  return undefined;
}

/** Whether a write runs in the function that makes `cls` — over before any instance of it exists. */
function madeTooEarly(write: Write, cls: ts.ClassLikeDeclaration): boolean {
  return write.fn.getSourceFile() === cls.getSourceFile() && cls.pos >= write.fn.pos && cls.end <= write.fn.end;
}

/** The writes of each file, by variable — per program, because the symbols are one checker's. */
const writesInFile = new WeakMap<Resolver, WeakMap<ts.SourceFile, Map<ts.Symbol, Write[]>>>();

/**
 * Every write to a `let` or `var` that runs after its module was first evaluated — collected once per
 * file for the whole program, since nothing in the answer depends on who reads it. Only the declaring
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

/**
 * The writes to this class's ordinary fields that can come after the first render, by field — the
 * same fields and the same members `staleFieldsOf` judges, with where each write runs. A static
 * member's `this` is the class, and a nested `function`'s is its own: neither writes an instance field.
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
      writesUnder(member, true, (target) => {
        if (
          !ts.isPropertyAccessExpression(target) ||
          target.expression.kind !== ts.SyntaxKind.ThisKeyword ||
          !plain.has(target.name.text)
        )
          return;
        const field = target.name.text;
        const fn = runsIn(target);
        // An instance field's initializer writes this instance before its first render — the constructor's
        // time, which `writesAfterTheFirstRender` does not count either.
        if (fn === undefined || ts.isPropertyDeclaration(fn)) return;
        const list = writes.get(field) ?? [];
        list.push({ writer, fn });
        writes.set(field, list);
      });
    }
  }
  return writes;
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
 * on the spot is (`runsNow`). Bounded and cycle-guarded. A function
 * the program does not declare — a library's, the platform's — is not followed, and what it reads is not
 * known here.
 */
function readsIn(
  node: ts.Node,
  cls: ts.ClassLikeDeclaration,
  declaring: readonly ts.ClassLikeDeclaration[],
  resolve: Resolver,
): Reads {
  const reads: Reads = { fields: new Set(), variables: new Map() };
  // A props callback names its owner as `this`, its parameter, or the parameter destructured — see
  // `callbackOwner`. A method the walk follows into has only `this`, and a free function none.
  const callback = callbackOwner(node);
  const seenBound = new Set<ts.Node>();
  const seenUnbound = new Set<ts.Node>();

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

  const walk = (at: ts.Node, depth: number, hasThis: boolean): void => {
    // Once per body and per `this`: the same body reached unbound first and bound later reads more the
    // second time — a `function` a getter returns, called destructured and then through the owner.
    const seenAs = hasThis ? seenBound : seenUnbound;
    if (depth > 6 || seenAs.has(at)) return;
    seenAs.add(at);

    /**
     * Runs what reading or calling a member runs, and says whether it is a member that runs at all. A
     * GETTER runs when it is read; called (`this.fmt()`), what it returns runs too — so every function
     * written in it is walked, whichever branch returns it, with the instance's `this` when it is reached
     * through the owner (`bound`). A METHOD runs when it is called or handed to a call (`.map(this.format)`,
     * see `runsNow`), and is bound to the instance by the framework. A field holding a function is NOT
     * followed: `arrow-fields` refuses every such field, and written as a method it is followed here.
     */
    const follow = (member: ts.ClassElement, runs: boolean, bound: boolean): boolean => {
      if (plainGetter(member)) {
        walk(member, depth + 1, true);
        if (runs && member.body !== undefined) {
          (function returned(at: ts.Node): void {
            if (ts.isArrowFunction(at) || ts.isFunctionExpression(at)) {
              walk(at.body, depth + 1, ts.isArrowFunction(at) || bound);
              return;
            }
            ts.forEachChild(at, returned);
          })(member.body);
        }
        return true;
      }
      if (!ts.isMethodDeclaration(member)) return false;
      if (runs && member.body !== undefined) walk(member.body, depth + 1, true);
      return true;
    };

    const owner = at === node ? callback : callbackOwner(at);
    (function look(current: ts.Node): void {
      if (current !== at) {
        // Built, not run: a function returned, stored or handed over in an object, or an accessor of one.
        if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current)) && !runsNow(current)) return;
        if (isHandedOver(current)) return;
        if (ts.isAccessor(current) && ts.isObjectLiteralExpression(current.parent)) return;
      }
      if (ts.isIdentifier(current)) {
        if (hasThis && owner.destructured.has(current.text) && isLocalRead(current)) {
          const name = owner.destructured.get(current.text) as string;
          // Methods are bound to the instance, so a destructured one runs as `self.priced()` would.
          let followed = false;
          for (const member of nearestNamed(name)) followed = follow(member, runsWhere(current), false) || followed;
          if (!followed) reads.fields.add(name);
        }
        const outer = outerVariable(current, at === node ? node : (at.parent ?? at), cls, resolve);
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
        // Bound only when called through the owner: handed to a call, what a getter returns is called bare.
        const calledHere = ts.isCallExpression(current.parent) && current.parent.expression === current;
        for (const member of nearestNamed(name)) followed = follow(member, runsWhere(current), calledHere) || followed;
        if (!followed) reads.fields.add(name);
      }
      if (ts.isCallExpression(current) && ts.isIdentifier(current.expression)) {
        const fn = projectFunction(current.expression, resolve);
        // An ARROW written inside the class keeps the instance's `this` — `const price = (n) => n *
        // this.rate` in a compute, called a line later. A `function`, or one written outside, has none.
        const keepsThis =
          fn !== undefined &&
          ts.isArrowFunction(fn) &&
          fn.getSourceFile() === cls.getSourceFile() &&
          fn.pos >= cls.pos &&
          fn.end <= cls.end;
        if (fn?.body !== undefined) walk(fn.body, depth + 1, hasThis && keepsThis);
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
    for (const one of declaring) {
      const named = one.members.filter((each) => memberName(each) === name);
      if (named.length === 0) continue;
      return named.find(
        (each): each is ts.MethodDeclaration => ts.isMethodDeclaration(each) && each.body !== undefined,
      );
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
      const reads = readsIn(node, cls, declaring, resolve);
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
