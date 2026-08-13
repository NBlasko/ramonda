import { ITEM_ID, identityOf, stampIdentity } from "../helpers/itemIdentity";

/**
 * Keeps the previous value where the new one is equal to it, so an answer that did not change
 * does not look like a change.
 *
 * ## Why anything does this at all
 *
 * A fetch replaces your data with whatever the fetcher returned — a fresh object every time,
 * even when the bytes are identical. Everything reading it then sees a change and re-renders,
 * and a list sees an array of objects it has never met. For a polled query that is the common
 * case, not the exception.
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
 * ## Why it rebuilds rather than answering yes or no
 *
 * A plain "are these equal" would only help when the WHOLE payload is unchanged. Rebuilding
 * costs the same walk and also keeps every unchanged SUBSTRUCTURE — which is what makes a
 * changed payload cheap too: `list()` reuses an item's scope when the item is the same object,
 * so a response where one row moved re-renders one row instead of all of them.
 *
 * ## `identity` — what it adds, and why it is the escape hatch
 *
 * Without it, arrays are compared POSITION BY POSITION and a length change is simply a change.
 * That is right for a cache and wrong for rows: reorder a list, or add one row, and nothing is
 * shared even though every row is the same row.
 *
 * With it, rows are paired by what you say identifies them, and then two things follow. An
 * unchanged row comes back as the SAME OBJECT wherever it moved to. A CHANGED row comes back
 * as a new object carrying its predecessor's identity, so `list()` updates that row in place
 * instead of destroying the component on it.
 *
 * That is the one place an app can state what only it knows. `list()` infers identity, and for
 * the shapes real data takes it is right — but it is inference, and it has no way to be told
 * otherwise. Saying it HERE says it once, where the data enters, rather than on every list
 * that renders it.
 *
 * ```ts
 * this.rows = merge(this.rows, await api.getRows(), (row) => row.id);
 * ```
 *
 * `identity` is asked per item and per array. A value of `undefined` means "I cannot identify
 * this one", and that array falls back to the positional walk — so a nested array of
 * primitives, or one whose items have a different shape, degrades instead of misbehaving.
 *
 * ## The bounds, and why it fails towards "changed"
 *
 * The value may be anything a fetcher returned, including something cyclic, so an unbounded
 * walk is a hang waiting to happen. Two bounds, and it takes both: a node budget for width and
 * a depth cap for recursion. The budget alone was the first version, and a test killed it — a
 * cycle recurses one frame per visit, so it blew the call stack long before 20 000 visits.
 *
 * Past either bound the new value is returned as-is. That is the safe direction: a render that
 * was not needed costs a frame, where a missed render shows stale data forever.
 *
 * Only arrays and plain objects are traversed. A `Date`, a `Map`, a class instance — anything
 * with a prototype of its own — is compared by identity and otherwise taken as changed, because
 * equality for those is the app's business and guessing it wrong is worse than a render.
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

/** Says which row is which, for an app that knows. Return `undefined` to opt out. */
export type Identity = (item: unknown) => unknown;

interface Walk {
  left: number;
  identity: Identity | undefined;
}

export function merge<T>(previous: unknown, next: T, identity?: Identity): T {
  return walk(previous, next, { left: BUDGET, identity }, 0) as T;
}

/** The name query has used for this since before it took an identity. */
export const replaceEqualDeep = merge;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function walk(previous: unknown, next: unknown, state: Walk, depth: number): unknown {
  if (Object.is(previous, next)) return previous;
  if (depth >= MAX_DEPTH || state.left-- <= 0) return next;

  if (Array.isArray(previous) && Array.isArray(next)) {
    const paired = state.identity === undefined ? undefined : pairByIdentity(previous, next, state.identity);
    if (paired !== undefined) return mergeArray(previous, next, paired, state, depth);

    // Positional, and a different length is simply a change. Without an identity
    // there is nothing to match a row by once the positions stop lining up, and
    // guessing is what `list()` does downstream with more to go on than this has.
    if (previous.length !== next.length) return next;
    return mergeArray(previous, next, undefined, state, depth);
  }

  if (isPlainObject(previous) && isPlainObject(next)) {
    const nextKeys = Object.keys(next);
    if (nextKeys.length !== Object.keys(previous).length) return next;

    const merged: Record<string, unknown> = {};
    let allSame = true;
    for (const key of nextKeys) {
      if (!(key in previous)) return next;
      merged[key] = walk(previous[key], next[key], state, depth + 1);
      if (!Object.is(merged[key], previous[key])) allSame = false;
    }
    return allSame ? previous : merged;
  }

  return next;
}

/**
 * For each item in `next`, the item in `previous` that is the same row — or `-1`.
 *
 * `undefined` back means this array opted out: some item had no identity, so there
 * is nothing to pair on and the positional walk is the honest answer.
 */
function pairByIdentity(previous: readonly unknown[], next: readonly unknown[], identity: Identity): number[] | undefined {
  // Asked only of OBJECTS. The walk recurses into every array it meets, including
  // one of strings inside a row, and a callback written for rows — `(row) =>
  // row.id` — throws on a string long before it can decline. A primitive has no
  // identity to state anyway: its value is one.
  const at = new Map<unknown, number>();
  for (let i = 0; i < previous.length; i++) {
    if (previous[i] === null || typeof previous[i] !== "object") return undefined;
    const key = identity(previous[i]);
    if (key === undefined) return undefined;
    // A duplicate identity is the app's own contradiction, and pairing one of the
    // two arbitrarily would put one row's state on the other. First wins, and the
    // second is treated as a row this has not seen.
    if (!at.has(key)) at.set(key, i);
  }

  const paired = new Array<number>(next.length);
  const claimed = new Set<number>();
  for (let i = 0; i < next.length; i++) {
    if (next[i] === null || typeof next[i] !== "object") return undefined;
    const key = identity(next[i]);
    if (key === undefined) return undefined;
    const from = at.get(key);
    paired[i] = from !== undefined && !claimed.has(from) ? from : -1;
    if (paired[i] !== -1) claimed.add(paired[i]);
  }
  return paired;
}

function mergeArray(
  previous: readonly unknown[],
  next: readonly unknown[],
  paired: number[] | undefined,
  state: Walk,
  depth: number,
): unknown {
  const merged: unknown[] = new Array(next.length);
  let allSame = next.length === previous.length;

  for (let i = 0; i < next.length; i++) {
    const from = paired === undefined ? i : paired[i];
    if (from === -1) {
      // A row this array did not have. Nothing to share and nothing to carry.
      merged[i] = next[i];
      allSame = false;
      continue;
    }

    const was = previous[from];
    merged[i] = walk(was, next[i], state, depth + 1);

    if (!Object.is(merged[i], was)) {
      allSame = false;
      // The row CHANGED, so it is a new object — and it is still the row it was.
      // Carrying the identity is what lets `list()` update it in place rather than
      // destroying the component sitting on it. An unchanged row needs none of
      // this: it came back as the same object, identity and all.
      const id = identityOf(was);
      if (id !== undefined) stampIdentity(merged[i], id);
    } else if (from !== i) {
      // Same object, different position: shared, but the array did move.
      allSame = false;
    }
  }

  return allSame ? previous : merged;
}

/**
 * Hands `@ramonda/lens` the one thing it needs to keep a list item's identity
 * across a `set`, without either package importing the other.
 *
 * A lens carries hidden data across an EDIT on its own — `merge`, `update`, a
 * write aimed deeper — because an edit is a continuation of the value. A `set`
 * is handed a value instead of deriving one, so it cannot know whether the new
 * value is the same item or a different one, and it keeps nothing unless told.
 *
 * Told is this:
 *
 * ```ts
 * import { focusOn } from "@ramonda/lens";
 * import { SAME_ITEM } from "@ramonda/core";
 *
 * this.items = focusOn(this.items).at(0).set(rebuilt, SAME_ITEM);
 * ```
 *
 * The name states the FACT the caller knows — this is that same item — and
 * leaves the consequence to the framework. Ready-made rather than left to the
 * caller, because the alternative is an app writing out a symbol it should
 * never have to name.
 */
export const SAME_ITEM: { keepSymbols: readonly symbol[] } = { keepSymbols: [ITEM_ID] };
