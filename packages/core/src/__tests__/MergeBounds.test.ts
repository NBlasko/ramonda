import { describe, expect, test } from "vitest";
import { merge } from "../base/merge";

/**
 * The BOUNDS `merge` declares — depth, budget, and what it refuses to traverse.
 *
 * `Merge.test.tsx` beside this one covers what merge SHARES: equal values, a changed row among
 * unchanged ones, reorders, identity, a duplicate identity, the positional fallback. None of it
 * reaches the limits, and the limits are the half that fails silently — a bound that stops working
 * costs a stack overflow or a hang, not a wrong value.
 *
 * ## What the limits are, measured rather than read
 *
 * `MAX_DEPTH` is 50 and `BUDGET` is 20 000, and the file says depth is what makes a cycle safe while
 * the budget bounds width. `@ramonda/query`'s cycle test said the opposite — "the node budget is what
 * makes this safe" — so the two disagreed and one had to be wrong. Measured: a 60-deep pair of equal
 * chains comes back unshared and a 40-deep pair comes back shared, so what cuts a self-cycle at 50
 * frames is depth. The file was right, and that comment is corrected.
 *
 * The budget cannot be what stops it, and the reason is the line above the check: `walk` returns at
 * `Object.is(previous, next)` BEFORE it spends anything, so a pair of equal leaves costs nothing. The
 * budget is spent only on values that DIFFER, which is why 30 000 equal keys are still shared.
 *
 * ## Why the file is here rather than in query
 *
 * `merge` is also reached from `@ramonda/query`, through the one-line re-export in
 * `query/src/structuralSharing.ts`. Coverage is per package — core's run does not execute query's
 * tests, and query's run does not instrument core's sources — so a branch exercised only from there
 * reads as dead here and the union of core's two runs cannot tell. A function's tests belong beside
 * it; that is also what keeps the map honest.
 */
const chain = (depth: number): Record<string, unknown> => {
  let node: Record<string, unknown> = { leaf: 1 };
  for (let i = 0; i < depth; i++) node = { next: node };
  return node;
};

describe("the bounds merge declares", () => {
  test("a value deeper than MAX_DEPTH is returned as-is rather than shared", () => {
    // 60 levels, every one of them equal. Sharing would be correct and the bound refuses it anyway:
    // the worst case of giving up is a render that was not needed, and the worst case of recursing
    // is the call stack.
    const previous = chain(60);

    expect(merge(previous, chain(60))).not.toBe(previous);
  });

  test("and one inside it is shared, so the bound is a depth and not a refusal to recurse", () => {
    const previous = chain(40);

    expect(merge(previous, chain(40))).toBe(previous);
  });

  test("a cycle terminates, and it is the DEPTH bound that ends it", () => {
    const previous: Record<string, unknown> = { name: "a" };
    previous.self = previous;
    const next: Record<string, unknown> = { name: "a" };
    next.self = next;

    expect(() => merge(previous, next)).not.toThrow();
    // Not the budget: 20 000 frames of a self-cycle blow the stack, which is the measurement the
    // file records as the reason depth exists. Depth stops this at 50.
    expect(merge(previous, next)).not.toBe(previous);
  });

  test("the budget is spent on values that DIFFER, so equal width is not bounded by it", () => {
    // 30 000 keys against a budget of 20 000, and still shared: `walk` returns at
    // `Object.is(previous, next)` before the budget is touched, so an equal leaf costs nothing.
    const previous: Record<string, number> = {};
    const next: Record<string, number> = {};
    for (let i = 0; i < 30_000; i++) {
      previous[`k${i}`] = i;
      next[`k${i}`] = i;
    }

    expect(merge(previous, next)).toBe(previous);
  });
});

describe("what merge will not traverse", () => {
  test("an object with a prototype of its own is compared by identity only", () => {
    const previous = new Date(0);

    // Equal by value and not shared: equality for a Date, a Map or a class instance is the app's
    // business, and guessing it wrong is worse than a render.
    expect(merge(previous, new Date(0))).not.toBe(previous);
  });

  test("a null-prototype object IS traversed, because it is still a plain bag of keys", () => {
    // `Object.create(null)` is what a parsed query string or a `Map`-free lookup table often is, and
    // the plain-object test names it explicitly: `proto === Object.prototype || proto === null`.
    const previous = Object.assign(Object.create(null) as Record<string, unknown>, { a: 1 });
    const next = Object.assign(Object.create(null) as Record<string, unknown>, { a: 1 });

    expect(merge(previous, next)).toBe(previous);
  });

  test("a key set that grew, shrank or was renamed is simply the new value", () => {
    // `toBe(next)`, not `toEqual` — "simply the new value" means the object handed in, and nothing
    // rebuilt from it. Measured: with the renamed-key check removed, a `toEqual` assertion still
    // passes, because the rebuilt object has the same contents. The identity is the whole promise.
    const previous = { a: 1, b: 2 };
    const shrank = { a: 1 };
    const grew = { a: 1, b: 2, c: 3 };
    // Same COUNT, different names — the branch a length check alone would miss.
    const renamed = { a: 1, c: 2 };

    expect(merge(previous, shrank)).toBe(shrank);
    expect(merge(previous, grew)).toBe(grew);
    expect(merge(previous, renamed)).toBe(renamed);
  });
});
