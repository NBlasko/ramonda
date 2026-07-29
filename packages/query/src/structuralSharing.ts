/**
 * Keeps the previous value where the new one is equal to it, so an answer that did not change
 * does not look like a change.
 *
 * ## Why the cache does this at all
 *
 * A fetch replaces `entry.data` with whatever the fetcher returned — a fresh object every
 * time, even when the bytes are identical. Every observer of that key then sees a changed
 * `data` and re-renders. For a polled query that is the common case, not the exception.
 *
 * Measured in jsdom, comparing the cost of the comparison against the cost of the render it
 * prevents, on a table of rows with six fields each:
 *
 * ```
 *   rows   deep compare   JSON.stringify   render + DOM commit
 *   10        28 µs           28 µs             5.4 ms
 *   100      137 µs          136 µs            26 ms
 *   1000     811 µs        1 287 µs           272 ms
 * ```
 *
 * So the commit is 190–335× the comparison. jsdom is not a browser — there is no layout or
 * paint here, and its nodes are slower than the real thing — but no plausible correction
 * closes two orders of magnitude.
 *
 * (The first version of that benchmark reported the opposite, because it timed `setData`
 * without flushing: 21 writes, 3 renders. The numbers above are with `flushSync` inside the
 * timed loop.)
 *
 * ## Why it rebuilds rather than answering yes or no
 *
 * A plain "are these equal" would only help when the WHOLE payload is unchanged. Rebuilding
 * costs the same walk and also keeps every unchanged SUBSTRUCTURE — which is what makes a
 * changed payload cheap too: `list()` reuses an item's scope when `existing.item === item`, so
 * a response where one row moved re-renders one row instead of all of them.
 *
 * ## The bound, and why it fails towards "changed"
 *
 * A cache holds whatever a fetcher returned, including something cyclic, so an unbounded walk
 * is a hang waiting to happen. Two bounds, and it takes both: a node budget for width and a
 * depth cap for recursion. The budget alone was the first version, and a test killed it — a
 * cycle recurses one frame per visit, so it blew the call stack long before 20 000 visits.
 *
 * Past either bound the new value is returned as-is. That is the safe direction: a render that
 * was not needed costs a frame, where a missed render shows stale data forever.
 *
 * Only arrays and plain objects are traversed. A `Date`, a `Map`, a class instance — anything
 * with a prototype of its own — is compared by identity and otherwise taken as changed,
 * because equality for those is the app's business and guessing it wrong is worse than a
 * render.
 */

/** How many values one comparison may visit. Enough for a large page, small enough to bound. */
const BUDGET = 20_000;

/**
 * How deep it will go. A budget alone is not enough, and a test proved it: a cyclic value
 * recurses one frame per visit, so 20 000 visits blew the call stack (`RangeError: Maximum
 * call stack size exceeded`) long before the budget ran out. Depth is the bound that makes a
 * cycle safe; the budget bounds width.
 */
const MAX_DEPTH = 50;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function replaceEqualDeep<T>(previous: unknown, next: T): T {
  return walk(previous, next, { left: BUDGET }, 0) as T;
}

function walk(previous: unknown, next: unknown, budget: { left: number }, depth: number): unknown {
  if (Object.is(previous, next)) return previous;
  if (depth >= MAX_DEPTH || budget.left-- <= 0) return next;

  if (Array.isArray(previous) && Array.isArray(next)) {
    if (previous.length !== next.length) return next;

    const merged: unknown[] = new Array(next.length);
    let allSame = true;
    for (let i = 0; i < next.length; i++) {
      merged[i] = walk(previous[i], next[i], budget, depth + 1);
      if (!Object.is(merged[i], previous[i])) allSame = false;
    }
    // Every element came back unchanged, so the array itself is unchanged — hand back the old
    // one and the identity check upstream sees nothing to do.
    return allSame ? previous : merged;
  }

  if (isPlainObject(previous) && isPlainObject(next)) {
    const nextKeys = Object.keys(next);
    if (nextKeys.length !== Object.keys(previous).length) return next;

    const merged: Record<string, unknown> = {};
    let allSame = true;
    for (const key of nextKeys) {
      if (!(key in previous)) return next;
      merged[key] = walk(previous[key], next[key], budget, depth + 1);
      if (!Object.is(merged[key], previous[key])) allSame = false;
    }
    return allSame ? previous : merged;
  }

  return next;
}
