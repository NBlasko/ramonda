import ts from "typescript";
import { memberName } from "../syntax";

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
  resolve(id: ts.Node): ts.Symbol | undefined;
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
 */
function heritage(cls: ts.ClassDeclaration, resolve: RenderReach["resolve"]): ts.ClassLikeDeclaration[] {
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

/** Whether a member carries a given decorator, by name. */
export function hasDecorator(member: ts.ClassElement, name: string): boolean {
  for (const decorator of ts.getDecorators(member as ts.HasDecorators) ?? []) {
    const expression = ts.isCallExpression(decorator.expression)
      ? decorator.expression.expression
      : decorator.expression;
    if (ts.isIdentifier(expression) && expression.text === name) return true;
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
export function stateFieldsOf(cls: ts.ClassDeclaration, resolve?: RenderReach["resolve"]): ReadonlySet<string> {
  const found = new Set<string>();

  const declared = resolve === undefined ? [cls] : [cls, ...heritage(cls, resolve)];
  for (const declaring of declared) {
    for (const member of declaring.members) {
      if (!ts.isPropertyDeclaration(member)) continue;
      if (!hasDecorator(member, "state") && !hasDecorator(member, "persist")) continue;
      const name = memberName(member);
      if (name !== undefined) found.add(name);
    }
  }

  return found;
}

/** Where a render begins: `render()` itself, and every `@compute`. */
export function entryPoints(cls: ts.ClassDeclaration): { member: ts.ClassElement; name: string }[] {
  const found: { member: ts.ClassElement; name: string }[] = [];
  for (const member of cls.members) {
    const name = memberName(member);
    if (name === undefined) continue;
    if (name === "render" || hasDecorator(member, "compute")) found.push({ member, name });
  }
  return found;
}

/**
 * Whether a nested function runs DURING the render, rather than later.
 *
 * Stated this way round on purpose, and the first version was not — it walked into everything
 * except a function written directly as a JSX attribute. Measured against this repository, that
 * reported five places, and every one of them was `@memoizedHandler`:
 *
 * ```tsx
 * @memoizedHandler finish(id: number) {
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
 */
function runsNow(fn: ts.ArrowFunction | ts.FunctionExpression): boolean {
  const parent = fn.parent;
  if (parent === undefined) return false;

  // `rows.map((row) => …)` — an argument, so whoever was called decides, and all of the ones that
  // matter here call it immediately.
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

      if (ts.isCallExpression(current)) {
        const callee = current.expression;

        // `this.helper()` — a method on this very class, so `this` still means the component.
        if (
          ts.isPropertyAccessExpression(callee) &&
          callee.expression.kind === ts.SyntaxKind.ThisKeyword &&
          ts.isIdentifier(callee.name)
        ) {
          const name = callee.name.text;
          // This class first, then its bases: a base is another class and the same object, so
          // `this` still means the component and `insideTheClass` stays true.
          for (const declaring of own) {
            for (const member of declaring.members) {
              if (memberName(member) !== name) continue;
              const body = ts.isMethodDeclaration(member) ? member.body : undefined;
              if (body) walk(body, [...through, name], true, depth + 1);
            }
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

  for (const { member, name } of entryPoints(cls)) {
    const body = ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member) ? member.body : undefined;
    if (body) walk(body, [name], true, 0);
  }
}
