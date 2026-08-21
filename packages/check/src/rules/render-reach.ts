import ts from "typescript";
import { memberName } from "../syntax";
import type { Resolver } from "./rule";

/**
 * Everything a render can reach — not everything a render is written to contain.
 *
 * ## Why the walk, and why a rule that skipped it would find the easy half
 *
 * A `render()` almost never holds the fault in its own body. It calls a helper on the class, which
 * calls a formatter imported from another file, which reads a clock; or a chain of `if`/`else`
 * picks one of four branches and only the third one writes state. A rule that looked at the body of
 * `render()` would report the version somebody wrote by accident on their first day and miss the
 * version that actually ships.
 *
 * So this follows the calls: methods on the same class, and functions resolved through the
 * checker — which follows imports, so a helper three files away is reached like any other.
 *
 * ## The one place it deliberately stops
 *
 * **A function written as the value of a JSX attribute is not walked.** `onClick={() => this.count
 * += 1}` is a handler: it runs when somebody clicks, which is exactly when writing state is the
 * right thing to do. Walking into it would report the single commonest correct line in any
 * application, and a rule that does that is a rule somebody switches off.
 *
 * Everything else IS walked, because everything else runs now: an argument to `map`, the callback
 * in `list(each, …)`, an immediately-invoked function. The framework's own analyzer already treats
 * a `list` callback as rendering where the list sits.
 *
 * ## What it cannot see, and says nothing about
 *
 * A helper handed the component itself — `format(this)` — writing through the parameter. Following
 * that is dataflow, which this package refuses by decision. And anything behind a value: a function
 * picked out of a record, a method called through a variable.
 *
 * A method on a BASE CLASS used to be on that list and is not any more — see {@link heritage}. It
 * was the one item there that was a gap rather than a decision: a base is another class and the
 * same object, so `this` still means the component, and a `render()` reaching a write through an
 * inherited method reported nothing at all. Found by planting it.
 *
 * ## Four more paths that were gaps, all found the same way
 *
 * The claim is "reached from a render, BY ANY PATH", and only a `this.method()` call was followed.
 * Each of these was planted and reported nothing; the runtime catches all four, because
 * `renderPhase.component` is set whatever the path was.
 *
 * - An arrow **field** — `helper = () => { … }` — which is a property rather than a method, so the
 *   lookup for a `MethodDeclaration` found nothing. See {@link memberBody}.
 * - A **getter**, which is READ rather than called: `{this.total}` runs its body right there.
 * - **`super.method()`**, whose callee is not `this`.
 * - A **static**, `App.helper()`. Walked with `insideTheClass` false, because inside a static
 *   `this` is the constructor rather than the instance — so a write through it is nobody's state,
 *   while a clock read is still a clock read.
 */

/** How deep the call chain is followed before giving up. Deep enough for real code, bounded. */
const MAX_DEPTH = 12;

export interface ReachedSite {
  /** The node to report — the write, or the call to the clock. */
  node: ts.Node;
  /**
   * How the render got here: `render → rowFor → formatWhen`.
   *
   * The most useful half of the report. A clock read three files away is baffling on its own and
   * obvious once the path is written down.
   */
  through: readonly string[];
}

export interface RenderReach {
  /** Called for every node inside anything the render reaches. */
  visit(node: ts.Node, through: readonly string[], insideTheClass: boolean): void;
  resolve: Resolver;
}

/**
 * Every class in this one's heritage chain, nearest first, as far as declarations can be followed.
 *
 * `this.helper()` used to be looked for in `cls.members` and nowhere else, so a method INHERITED
 * from a base class was never found and the walk stopped there without a word. Measured: a
 * `render()` calling `this.touch()`, where `touch` is on a base in another file and writes
 * `this.n`, reported nothing at all.
 *
 * That is not the same case as a free function, and the distinction is the whole of it: a base
 * class is another CLASS but the same OBJECT, so `this` still means the component and a write
 * through it is still the component's. `insideTheClass` stays true across the hop.
 *
 * Bounded, because a chain that resolves in a ring would otherwise not end — and four is more
 * heritage than any component here has.
 *
 * Exported because three other rules ask the same question about the same chain, and each of them
 * was wrong without it: a component's contexts, its cleanup and its state are the component's
 * wherever the member is written down. See `one-provider-per-component`,
 * `context-consumed-above-its-provider` and `interval-with-no-cleanup`.
 */
export function heritage(cls: ts.ClassDeclaration, resolve: Resolver): ts.ClassLikeDeclaration[] {
  const chain: ts.ClassLikeDeclaration[] = [];
  let at: ts.ClassLikeDeclaration | undefined = cls;

  for (let hop = 0; hop < 4 && at !== undefined; hop++) {
    const base: ts.Expression | undefined = at.heritageClauses?.find(
      (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword,
    )?.types[0]?.expression;
    if (base === undefined || (!ts.isIdentifier(base) && !ts.isPropertyAccessExpression(base))) break;

    const declaration: ts.ClassLikeDeclaration | undefined = resolve(base)?.declarations?.find(
      (one): one is ts.ClassLikeDeclaration => ts.isClassLike(one),
    );
    if (declaration === undefined || chain.includes(declaration)) break;

    // A declaration file or a dependency: nothing to walk, and not ours to judge either.
    const file = declaration.getSourceFile();
    if (file.isDeclarationFile || file.fileName.includes("node_modules")) break;

    chain.push(declaration);
    at = declaration;
  }

  return chain;
}

/**
 * Whether a member carries CORE's `@name` — by the name core exports it under, not the local one.
 *
 * This matched a bare name for a long time, and it failed in both directions at once. Measured with
 * two identical components, one written `import { state as reactive }`: the plain one produced two
 * reports and the aliased one produced NOTHING, from any rule. The other direction is the shape
 * `own-list.ts`, `own-head.tsx` and `own-helper.tsx` exist to keep out of three other rules — an
 * app's own decorator called `state` was judged as core's.
 *
 * `resolve` is required rather than defaulted, which is the standing lesson here: a defaulted one
 * on `numberAttr` silenced every tree rule for a commit, and a guard a caller can forget looks
 * exactly like a clean codebase.
 */
export function hasDecorator(member: ts.ClassElement, name: string, resolve: Resolver): boolean {
  for (const decorator of ts.getDecorators(member as ts.HasDecorators) ?? []) {
    const expression = ts.isCallExpression(decorator.expression)
      ? decorator.expression.expression
      : decorator.expression;
    if (resolve.coreName(expression) === name) return true;
  }
  return false;
}

/**
 * The fields this class has as state — the only ones a write to is `RMD001`.
 *
 * **Its BASES too**, and that was a gap rather than a decision: a component whose state lives on a
 * shared base class had none of it recognised, so every write to it was invisible — measured, with
 * `@state n` on a base and `this.n = 1` reached from the subclass's render, and nothing reported.
 * Inherited state is the component's state; where the field is written down does not change that.
 *
 * `resolve` is optional so a caller with no checker still gets the class's own fields, which is the
 * behaviour this had before.
 */
export function stateFieldsOf(cls: ts.ClassDeclaration, resolve: Resolver): ReadonlySet<string> {
  const found = new Set<string>();

  for (const declaring of [cls, ...heritage(cls, resolve)]) {
    for (const member of declaring.members) {
      if (!ts.isPropertyDeclaration(member)) continue;
      if (!hasDecorator(member, "state", resolve) && !hasDecorator(member, "persist", resolve)) continue;
      const name = memberName(member);
      if (name !== undefined) found.add(name);
    }
  }

  return found;
}

/** Where a render begins: `render()` itself, and every `@compute`. */
export function entryPoints(cls: ts.ClassDeclaration, resolve: Resolver): { member: ts.ClassElement; name: string }[] {
  const found: { member: ts.ClassElement; name: string }[] = [];
  for (const member of cls.members) {
    const name = memberName(member);
    if (name === undefined) continue;
    if (name === "render" || hasDecorator(member, "compute", resolve)) found.push({ member, name });
  }
  return found;
}

/**
 * Whether a nested function runs DURING the render, rather than later.
 *
 * Stated this way round on purpose, and the first version was not — it walked into everything
 * except a function written directly as a JSX attribute. Measured against this repository, that
 * reported five places, and every one of them was `@memoized`:
 *
 * ```tsx
 * @memoized finish(id: number) {
 *   return () => { this.todo = …; this.done = …; };   // ← reported, and correct
 * }
 * render() { return <button onClick={this.finish(t.id)}>done</button>; }
 * ```
 *
 * The render really does call `finish`, so the walk was right to follow it — but what `finish`
 * RETURNS is the handler, and writing state there is the whole point of it. Reporting a first-class
 * idiom of the framework is the fastest way to have a checker switched off.
 *
 * So the question is not "is this a handler" — a handler can be reached in more ways than one can
 * enumerate — but "is this INVOKED here". Two shapes answer yes: an argument to a call, which is
 * `list(each, …)`, `.map(…)`, `.filter(…)` and their family; and a function invoked on the spot.
 * Everything else — returned, assigned, stored, handed to an attribute — runs at some other time,
 * and this says nothing about it.
 *
 * ## An argument to ANY call, including one that will run it later — and that is deliberate
 *
 * This was narrowed to an allowlist of the calls that run what they are handed, on the argument
 * that `setTimeout(() => { this.n = 1 }, 0)` in a render does not write state DURING the render.
 * The argument is true about the moment and false about the fault, and the difference was settled
 * by measuring rather than by reading either line:
 *
 * - `setTimeout(() => this.n += 1, 0)` armed from a render, guarded to stop at 50: **51 renders**.
 *   Unguarded it does not stop. That is `state-written-while-rendering`'s own sentence — "a render
 *   that schedules a render" — reached exactly, and narrowing this made it silent.
 * - `window.addEventListener("resize", …)` in a render: **6 listeners over 6 renders**, none
 *   removed. A render that registers something is a leak per pass.
 *
 * A `.then`, a `queueMicrotask` and a `setTimeout` written in a render are not the ordinary way to
 * defer work — they are a side effect armed by an answer to a question, once per time the question
 * is asked. The handler case this exists to protect is a function RETURNED or handed to an
 * attribute, and neither of those is a call argument, so nothing about it needs this narrowing.
 */
function runsNow(fn: ts.ArrowFunction | ts.FunctionExpression): boolean {
  const parent = fn.parent;
  if (parent === undefined) return false;

  // `rows.map((row) => …)` — an argument, so whoever was called decides, and all of the ones that
  // matter here call it immediately. One that calls it LATER is a render arming an effect, which is
  // the fault rather than an exception to it; the measurements above are why.
  if (ts.isCallExpression(parent) && parent.arguments.includes(fn)) return true;

  // `(() => …)()` — invoked on the spot, with or without the parentheses TypeScript keeps.
  if (ts.isCallExpression(parent) && parent.expression === fn) return true;
  if (
    ts.isParenthesizedExpression(parent) &&
    parent.parent !== undefined &&
    ts.isCallExpression(parent.parent) &&
    parent.parent.expression === parent
  ) {
    return true;
  }

  return false;
}

/**
 * What a member's body is, when the member has one that a call runs.
 *
 * A METHOD is the obvious half. The other is an arrow FIELD — `helper = () => { … }` — which is a
 * property rather than a method and was reached by nothing: `this.helper()` looked for a
 * `MethodDeclaration` and found a `PropertyDeclaration`, so the walk ended there without a word.
 * Measured with a plant, and the shape is not exotic: it is the one `arrow-fields` exists to talk
 * about, so a codebase that has any at all has them being called.
 */
/**
 * The NEAREST declaration of a member, which is the one that runs.
 *
 * A subclass overriding a base's method is ordinary, and walking both bodies reported the version
 * that never runs — measured, with a base whose `stamp()` reads a clock and a subclass whose
 * `stamp()` returns a constant. JS resolves a method by taking the first one up the chain, and so
 * does this.
 *
 * `from` is where to start looking: the class itself for `this.`, and its BASES for `super.`, which
 * is the whole meaning of the keyword.
 */
function nearest(from: readonly ts.ClassLikeDeclaration[], name: string): ts.ClassElement | undefined {
  for (const declaring of from) {
    for (const member of declaring.members) {
      if (memberName(member) === name) return member;
    }
  }
  return undefined;
}

export function memberBody(member: ts.ClassElement | undefined): ts.Node | undefined {
  if (member === undefined) return undefined;
  if (ts.isMethodDeclaration(member)) return member.body;
  if (ts.isPropertyDeclaration(member) && member.initializer !== undefined) {
    const written = member.initializer;
    if (ts.isArrowFunction(written) || ts.isFunctionExpression(written)) return written.body;
  }
  return undefined;
}

/** The body of whatever a call names, when that is a function this program declares. */
function bodyOf(declaration: ts.Declaration | undefined): ts.Node | undefined {
  if (declaration === undefined) return undefined;
  const file = declaration.getSourceFile();
  // A declaration file has no body to walk, and a dependency's internals are not ours to judge.
  if (file.isDeclarationFile || file.fileName.includes("node_modules")) return undefined;

  if (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)) return declaration.body;
  if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
    const value = declaration.initializer;
    if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return value.body;
  }
  return undefined;
}

/**
 * Walks everything the class's renders reach, calling `visit` for each node along the way.
 *
 * `insideTheClass` tells a caller whether `this` still means the component — a write to
 * `this.count` only means anything while it does, and once the walk has followed a call into a
 * free function, `this` is somebody else's.
 */
export function walkRenders(cls: ts.ClassDeclaration, reach: RenderReach): void {
  const seen = new Set<ts.Node>();
  /** This class first, then what it extends — a method is looked for in that order. */
  const own: ts.ClassLikeDeclaration[] = [cls, ...heritage(cls, reach.resolve)];

  const walk = (node: ts.Node, through: readonly string[], insideTheClass: boolean, depth: number): void => {
    if (depth > MAX_DEPTH || seen.has(node)) return;
    seen.add(node);

    const step = (current: ts.Node): void => {
      // A nested function is walked only when it is invoked HERE — see `runsNow`. Anything
      // returned, assigned or handed to an attribute runs at some other time, and the body of one
      // is exactly where writing state is correct.
      if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current)) && !runsNow(current)) return;

      reach.visit(current, through, insideTheClass);

      /**
       * A GETTER, which is READ rather than called.
       *
       * `{this.total}` in a render runs `get total()` right there, so a clock read or a state write
       * inside it happens during the render exactly as one in a method would — and the runtime
       * reports it, because `renderPhase.component` is set whatever the path was. Following only
       * calls missed every one of them. Measured with a plant.
       *
       * Only a name this class or a base declares as a getter is followed, so `this.props.x` and
       * every other ordinary read costs one member lookup and nothing else.
       */
      if (
        ts.isPropertyAccessExpression(current) &&
        current.expression.kind === ts.SyntaxKind.ThisKeyword &&
        ts.isIdentifier(current.name)
      ) {
        const found = nearest(own, current.name.text);
        if (found !== undefined && ts.isGetAccessorDeclaration(found) && found.body) {
          walk(found.body, [...through, current.name.text], true, depth + 1);
        }
      }

      if (ts.isCallExpression(current)) {
        const callee = current.expression;

        /**
         * `this.helper()` and `super.helper()` — the same object either way, so `this` still means
         * the component and `insideTheClass` stays true.
         *
         * `super` was a gap rather than a decision: the callee is not `this`, so a subclass calling
         * a base's method through it reached nothing at all.
         */
        if (
          ts.isPropertyAccessExpression(callee) &&
          (callee.expression.kind === ts.SyntaxKind.ThisKeyword ||
            callee.expression.kind === ts.SyntaxKind.SuperKeyword) &&
          ts.isIdentifier(callee.name)
        ) {
          const name = callee.name.text;
          // This class first, then its bases: a base is another class and the same object. `super.`
          // starts at the bases, which is the whole meaning of the keyword.
          const from = callee.expression.kind === ts.SyntaxKind.SuperKeyword ? own.slice(1) : own;
          const body = memberBody(nearest(from, name));
          if (body) walk(body, [...through, name], true, depth + 1);
        }

        /**
         * `App.helper()` — a static on this class or one of its bases.
         *
         * Walked with `insideTheClass` FALSE, and that is the whole of what makes it safe: inside a
         * static, `this` is the constructor rather than the instance, so a write through it is not
         * the component's state. What is still worth finding there is everything that does not
         * depend on `this` — a clock, a random number, a call to something else.
         */
        if (
          ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          ts.isIdentifier(callee.name)
        ) {
          // RESOLVED, not matched by name: a class whose name happens to equal this one's is a
          // different class, and this package does not guess about which declaration it is looking at.
          const declared = reach.resolve(callee.expression)?.declarations?.[0];
          if (declared !== undefined && own.includes(declared as ts.ClassLikeDeclaration)) {
            const body = memberBody(nearest(own, callee.name.text));
            if (body) walk(body, [...through, callee.name.text], false, depth + 1);
          }
        }

        // A plain name — a module function, or one imported from anywhere. `resolve` follows the
        // import for us, which is what makes a helper three files away reachable.
        if (ts.isIdentifier(callee)) {
          const body = bodyOf(reach.resolve(callee)?.declarations?.[0]);
          if (body) walk(body, [...through, callee.text], false, depth + 1);
        }
      }

      ts.forEachChild(current, step);
    };

    step(node);
  };

  for (const { member, name } of entryPoints(cls, reach.resolve)) {
    const body = ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member) ? member.body : undefined;
    if (body) walk(body, [name], true, 0);
  }

  /**
   * `@Host("nav", (self) => ({ className: … }))` — a render that is in no member body.
   *
   * It runs every time the component renders, and `entryPoints` looks only at members, so a clock
   * read there was reached by nothing. The id table had the same gap for the same callback, in a
   * different reader — a fix for one reader is not a fix for the other.
   *
   * `insideTheClass` is FALSE, exactly as it is for a static. The callback is handed the component
   * as a PARAMETER rather than through `this`, so nothing about `this` is knowable inside it and
   * only what depends on nothing — a clock, a random number — is worth finding.
   */
  const props = hostPropsCallback(cls);
  if (props !== undefined) walk(props, ["@Host props"], false, 0);
}

/** The second argument to `@Host`, when it is a function this can walk. */
function hostPropsCallback(cls: ts.ClassDeclaration): ts.Node | undefined {
  for (const decorator of ts.getDecorators(cls) ?? []) {
    const call = decorator.expression;
    if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || call.expression.text !== "Host") continue;

    const written = call.arguments[1];
    if (written === undefined) continue;
    if (ts.isArrowFunction(written) || ts.isFunctionExpression(written)) return written.body;
  }
  return undefined;
}
