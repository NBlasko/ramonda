import ts from "typescript";
import { follow, type Looking } from "./follow-value";
import type { ElementContext } from "./rule";

/**
 * What JSON does to a value, read off the source.
 *
 * Shared by the two rules that ask — `persist-of-a-lossy-value` and `unserializable-state` — because
 * they ask exactly the same question about exactly the same blob, and two copies of this table would
 * be two answers waiting to disagree about somebody's `Date`.
 *
 * `RMD033` is the runtime half of both, and it recurses for the same reason this does.
 */
/**
 * What JSON leaves behind, per constructor — the sentence the report prints.
 *
 * Written out rather than lumped into "not serializable" because the four differ in how they fail,
 * and the difference is what tells somebody whether their page is already broken: an empty object
 * fails at the first method call, while a `Date` that became a string fails only where somebody
 * asks it the time.
 */
export const BECOMES: ReadonlyMap<string, string> = new Map([
  ["Map", "an empty object — `{}`, with every entry gone"],
  ["Set", "an empty object — `{}`, with every member gone"],
  ["WeakMap", "an empty object — `{}`"],
  ["WeakSet", "an empty object — `{}`"],
  ["Date", "a string, which has no `getTime` and is not a `Date` on the other side"],
  ["RegExp", "an empty object — `{}`"],
  ["Error", "an empty object — the message and the stack are not JSON"],
  ["URL", "an empty object — `{}`"],
  ["URLSearchParams", "an empty object — `{}`"],
]);

/**
 * Constructors whose result IS JSON, so `new` alone is not evidence.
 *
 * Short on purpose. Every other `new` produces an object whose prototype JSON drops, which is the
 * whole fault — a class instance arrives as a plain bag of its own fields, with no methods.
 */
const STILL_JSON: ReadonlySet<string> = new Set(["Array", "Object", "String", "Number", "Boolean"]);

/** What a class instance becomes, said once. */
export const A_PLAIN_BAG = "a plain object — its fields survive, its prototype and every method do not";

/** The name a `new` expression constructs, dotted names included: `Intl.NumberFormat`. */
function constructedName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    const owner = constructedName(expression.expression);
    return owner === undefined ? undefined : `${owner}.${expression.name.getText()}`;
  }
  return undefined;
}

/**
 * What an EXPRESSION holds, looking inside object and array literals.
 *
 * The recursion is the whole of this, and its absence was the bug: `@persist opened = new Date()`
 * was reported while `@persist meta = { openedAt: new Date() }` was not — and the second is the
 * commoner shape by a distance. `RMD033`, this rule's runtime twin, recurses for exactly that
 * reason and says so; the static half was written shallow and claimed the same thing.
 *
 * Bounded at four, as the runtime check is: a literal nested deeper than that is not a shape
 * anybody writes into a hydration blob, and an unbounded walk over a self-referential type is a
 * hang rather than a report.
 */
export function lossyIn(written: ts.Expression, resolve: ElementContext["resolve"], depth = 0): Lossy | undefined {
  if (depth > 4) return undefined;

  const here = lossyShape(written, resolve, depth);
  if (here !== undefined) return here;

  /**
   * The value written somewhere else — `@persist cache = makeCache()`.
   *
   * A `Map` reached through a helper is the same `Map` in the blob, and it was silent: this rule
   * recursed INTO a literal and never followed a name out of one. A branch and a call are both
   * followed, because either path that puts a `Map` in the blob loses that data on that path.
   */
  const elsewhere = follow(written, resolve, lossyLeaf(resolve, depth));
  if (elsewhere === undefined) return undefined;

  /**
   * The INNERMOST name wins, which is what `Lossy.foundIn` promises and what the reader needs.
   *
   * `@persist blob = wrap()` where `wrap()` hands back `{ cache: makeCache() }` has two answers:
   * `wrap`, which is already on the line being read, and `makeCache`, which is where the `Map` is.
   * Taking the walk's own name unconditionally printed the first — sending the reader to the line
   * they were already looking at, which is the fault `Found.foundIn` exists to avoid.
   */
  return { ...elsewhere.value, foundIn: elsewhere.value.foundIn ?? elsewhere.foundIn };
}

/** What this expression IS, without following a name out of it. */
function lossyShape(written: ts.Expression, resolve: ElementContext["resolve"], depth: number): Lossy | undefined {
  if (ts.isArrowFunction(written) || ts.isFunctionExpression(written)) {
    return { holds: "a function", becomes: "nothing at all — JSON drops a function without a word" };
  }

  if (ts.isObjectLiteralExpression(written)) {
    for (const property of written.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const found = lossyIn(property.initializer, resolve, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  if (ts.isArrayLiteralExpression(written)) {
    for (const element of written.elements) {
      const found = lossyIn(element, resolve, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  if (ts.isNewExpression(written)) {
    const name = constructedName(written.expression);
    if (name === undefined || STILL_JSON.has(name)) return undefined;
    // Looked up by the WHOLE name as written, dots included. So `Intl.NumberFormat` misses the
    // table and is described as an instance, which is what it is; and a `Map` imported under
    // another name misses it too and gets the same, slightly less specific, true sentence.
    // Anything not named in the table is an instance, and JSON flattens all of them the same way.
    return { holds: name, becomes: BECOMES.get(name) ?? A_PLAIN_BAG };
  }

  // Anything else written out here is either fine or is a name, and a name is the caller's job.
  return undefined;
}

/** What a lossy value is and what JSON leaves of it — the pair both rules report. */
export interface Lossy {
  holds: string;
  becomes: string;
  /**
   * Where the value is built, when it is not on the line being reported — a local, or the function
   * that hands it back.
   *
   * `@state rows = level1()` told a reader it holds a `Map` and gave them nowhere to go. The
   * innermost name, not the outermost: `level1` is already on the line they are looking at.
   */
  foundIn?: string;
}

/**
 * The walk's leaf: the structural half, so following a name lands back in the same table.
 *
 * Built per call because it closes over the depth already spent — a `Map` four levels into a
 * literal that a helper returns is as far as this goes either way.
 */
function lossyLeaf(resolve: ElementContext["resolve"], depth: number): Looking<Lossy> {
  return {
    leaf: (expression) => lossyShape(expression, resolve, depth),
    throughModuleScope: true,
    throughBranches: true,
    throughCalls: true,
    throughMutableBindings: true,
  };
}
