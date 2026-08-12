import { valueEqual } from "./valueEqual";
import { diagnose } from "../debug/diagnostics";

/**
 * The identity an item carries WITH it, so a replaced object can still be the
 * row it replaces.
 *
 * ## Why the object, and not a map
 *
 * `ListEngine` already maps item → id, keyed by reference. That is enough while
 * the app keeps its references, and useless the moment data arrives from outside:
 * a refetch, a `JSON.parse`, a deserialize hands over objects nothing has seen,
 * every lookup misses, and every row is destroyed and built again — `@destroyed`,
 * `@created`, and whatever the row was holding, gone. Measured on a two-row list
 * where one title changed: both rows recreated, and a half-typed draft lost.
 *
 * An identity written ONTO the item travels with the data instead of with the
 * region, so it survives being handed around, and one item has one identity in
 * every list that shows it.
 *
 * ## Why a symbol, and non-enumerable
 *
 * It has to be invisible to everything the app does with its own data.
 * `JSON.stringify` never sees a symbol. `Object.keys`, `for…in` and equality
 * helpers never see a non-enumerable one. And SPREAD — `{ ...row }` — copies own
 * enumerable symbols, so an enumerable identity would give a copy the same
 * identity as its original, which is the one thing that must never happen: two
 * rows, one id. Non-enumerable, a copy is born with none and is aligned like any
 * other new object.
 *
 * ## A frozen item keeps its identity too
 *
 * `Object.defineProperty` throws on a frozen or sealed object, and for a while
 * that meant those rows had no identity at all — measured, a refetch of frozen
 * rows rebuilt every one of them, changed or not. Freezing your data is a
 * reasonable thing to do and it should not cost you that.
 *
 * So the write falls back to a WeakMap keyed on the item. It is the same identity
 * by every other measure — invisible to serialization, to `Object.keys`, to
 * spread — and weak keys mean an item that goes out of scope takes its entry with
 * it. Only a PRIMITIVE has nowhere to put one, and a primitive does not need one:
 * its value, or which occurrence it is, is already its identity.
 */
/**
 * From the GLOBAL symbol registry, not a fresh symbol.
 *
 * `@ramonda/lens` writes the same marker, and it does not — and should not —
 * depend on core to do it. `Symbol.for` is what lets two packages name the same
 * thing without one importing the other, and it also survives a build that ends
 * up with two copies of core, where a fresh symbol would quietly give the same
 * row two identities.
 */
export const ITEM_ID = Symbol.for("ramonda.row");

interface Identified {
  [ITEM_ID]?: string;
}

/** For items that cannot be written to. Weak, so an item that goes takes its entry. */
const frozenIds = new WeakMap<object, string>();

export function identityOf(item: unknown): string | undefined {
  if (item === null || typeof item !== "object") return undefined;
  // The property first: it is where all but the frozen ones keep it, and a miss
  // is the only thing that pays for the second lookup.
  return (item as Identified)[ITEM_ID] ?? frozenIds.get(item as object);
}

/** Writes an identity onto an item. A primitive has nowhere to put one, and needs none. */
export function stampIdentity(item: unknown, id: string): void {
  if (item === null || typeof item !== "object") return;
  try {
    Object.defineProperty(item, ITEM_ID, {
      value: id,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  } catch {
    // Frozen or sealed. Somewhere else, then — see the note at the top.
    frozenIds.set(item as object, id);
  }
}

/**
 * Carries identity from the array a list is showing to the array replacing it.
 *
 * This is the piece that makes "the same row, changed" expressible at all. A
 * changed row shares nothing with its predecessor — not the reference, not the
 * contents — so no comparison of the two ALONE can pair them. What pairs them is
 * their NEIGHBOURS: the rows around them that did not change.
 *
 * So it runs the same shape as a text diff. Rows equal by value are anchors, and
 * they are matched first. Whatever sits between two anchors in the old array is
 * then paired, in order, with whatever sits between the same two anchors in the
 * new one — that pairing is what a changed row rides across.
 *
 * The failure mode people fear from positional matching is exactly what this
 * avoids, and per ROW rather than by a threshold: a pair is only made when the
 * two still have a field in common, so page 2 of a table shares nothing with
 * page 1 and inherits none of it. That check is the whole guard. An earlier
 * version ALSO bailed out when no two rows were value-equal, which read as extra
 * safety and was not: it threw away the case where every row of a grid was
 * edited at once — a `.map` adding a cell to each — so every row rebuilt and
 * every cell inside it lost its state. Removing it changed nothing about
 * pagination, which was never carried by the anchors.
 */
export function carryIdentity(before: readonly unknown[], next: readonly unknown[], owner = "list"): void {
  if (before.length === 0 || next.length === 0) return;

  /** For each index in `next`, the index in `before` it was paired with. */
  const pairedTo = new Int32Array(next.length).fill(-1);
  const claimed = new Uint8Array(before.length);
  let unpaired = 0;

  // Anchors by REFERENCE first, which is most of them and costs a map lookup.
  // An update that kept its references — the ordinary local edit — finds every
  // row here and never builds the value index below at all.
  const byReference = new Map<unknown, number[]>();
  for (let i = 0; i < before.length; i++) {
    const at = byReference.get(before[i]);
    if (at) at.push(i);
    else byReference.set(before[i], [i]);
  }

  for (let i = 0; i < next.length; i++) {
    const at = byReference.get(next[i]);
    if (at !== undefined && at.length > 0) {
      const candidate = at.shift()!;
      pairedTo[i] = candidate;
      claimed[candidate] = 1;
    } else {
      unpaired++;
    }
  }

  // Every row accounted for by reference: nothing to carry, and the whole value
  // pass is skipped. This is the shape of a list nothing external touched.
  if (unpaired === 0) return;

  // Anchors by VALUE, for the rows a refetch replaced. Bucketed by a cheap
  // signature so this is one linear pass rather than every-against-every.
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < before.length; i++) {
    if (claimed[i] === 1) continue;
    const key = signature(before[i]);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(i);
    else buckets.set(key, [i]);
  }

  for (let i = 0; i < next.length; i++) {
    if (pairedTo[i] !== -1) continue;
    const bucket = buckets.get(signature(next[i]));
    if (bucket === undefined) continue;
    for (const candidate of bucket) {
      if (claimed[candidate] === 1) continue;
      if (!valueEqual(before[candidate], next[i])) continue;
      pairedTo[i] = candidate;
      claimed[candidate] = 1;
      break;
    }
  }

  // The runs between anchors, paired in order. `anchorBefore` walks the old
  // array's position for the last anchor seen, so an unmatched run knows which
  // stretch of the old array it corresponds to.
  let lastPairedNext = -1;
  let lastPairedBefore = -1;

  /**
   * The rows between two anchors, paired by how much they still have in common.
   *
   * Pairing them in order — first with first — is what a naive positional match
   * does, and it is wrong exactly where it matters. Measured on a front insert
   * that also changed a row: the BRAND NEW row was paired with the row above it,
   * took its identity and its half-typed draft, while the row that had merely
   * changed was handed a fresh one. Precisely inverted.
   *
   * So the run is paired by overlap instead: how many of the item's own primitive
   * fields still hold the same value. No field is privileged — an `id` counts for
   * exactly as much as a `title`, which is what keeps this from being the "guess
   * the id field" rule that cannot be made safe. A row that changed one field of
   * five still overlaps in four; a row that was never here overlaps in none, and
   * zero overlap is never a pair.
   */
  /**
   * Field values that occur more than once in the outgoing array.
   *
   * A field only says WHICH row this is if its value sets that row apart. `done:
   * false` on every row of a to-do list says nothing about which row it is, and
   * counting it is how page 2 of a table came to inherit page 1's rows: every row
   * shared the flag, so every pair scored a point and the first candidate won.
   * Measured — the half-typed draft moved to a different entity.
   */
  const common = new Set<string>();
  {
    const seen = new Map<string, number>();
    for (const item of before) {
      if (item === null || typeof item !== "object") continue;
      for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
        if (value !== null && typeof value === "object") continue;
        const at = `${key}\u0000${String(value)}`;
        const count = (seen.get(at) ?? 0) + 1;
        seen.set(at, count);
        if (count > 1) common.add(at);
      }
    }
  }

  const pairRun = (nextFrom: number, nextTo: number, beforeFrom: number, beforeTo: number) => {
    for (let n = nextFrom; n < nextTo; n++) {
      let best = -1;
      let bestScore = 0;
      for (let b = beforeFrom; b < beforeTo; b++) {
        if (claimed[b] === 1) continue;
        const score = overlap(before[b], next[n], b, n, common);
        if (score > bestScore) {
          bestScore = score;
          best = b;
        }
      }
      if (best === -1) {
        if (__DEV__) reportUnidentifiable(next[n], common, owner);
        continue;
      }
      pairedTo[n] = best;
      claimed[best] = 1;
    }
  };

  for (let i = 0; i < next.length; i++) {
    if (pairedTo[i] === -1) continue;
    pairRun(lastPairedNext + 1, i, lastPairedBefore + 1, pairedTo[i]);
    lastPairedNext = i;
    lastPairedBefore = pairedTo[i];
  }
  pairRun(lastPairedNext + 1, next.length, lastPairedBefore + 1, before.length);

  for (let i = 0; i < next.length; i++) {
    const from = pairedTo[i];
    if (from === -1) continue;
    const id = identityOf(before[from]);
    // Only an identity the engine actually minted travels. An old item that was
    // never rendered has none, and inventing one here would hand the new item an
    // id no region knows.
    if (id !== undefined && identityOf(next[i]) === undefined) stampIdentity(next[i], id);
  }
}

/**
 * How many of two items' own primitive fields still agree.
 *
 * Only own primitive fields, and only at the top level: a nested object is what
 * `valueEqual` is for, and walking it here would pay a deep comparison for every
 * candidate in a run rather than once for the pair that wins.
 *
 * ## A field that only restates the position is skipped
 *
 * `aAt` and `bAt` are where the two items sit in their arrays. A field whose
 * value equals that on BOTH sides is not describing the row, it is describing
 * where the row is — which position already says. Counting it lets it outvote a
 * field that does identify the row.
 *
 * Not hypothetical: a form's array rows are `{ id, index, field }`, so deleting
 * the first row leaves the survivor `{ id: "b", index: 0 }` to be matched against
 * `{ id: "a", index: 0 }` and `{ id: "b", index: 1 }` — one point each, the tie
 * broken by whichever came first, and the survivor took the DELETED row's
 * identity. Measured through the SSR playground, which marks a row's input and
 * checks it survives: the node was reused for the wrong row, taking its focus and
 * caret with it.
 *
 * Skipping can only REMOVE evidence, never invent it, so a field that happens to
 * equal its index by coincidence costs a little precision and cannot make a
 * false pair.
 */
/**
 * Reports a row that could not have been identified by ANY candidate — as opposed
 * to one that simply is not here yet.
 *
 * The distinction is the whole reason this can be said at all. A new row in a
 * paginated table is unpaired too, and reporting that would put a warning on
 * correct code — which is how a diagnostic becomes noise people scroll past. So
 * this asks about the ROW rather than the outcome: does it carry a single field
 * that could ever have paired it? A row of nothing but nested data, or one whose
 * every field is a flag its neighbours share, cannot be told from its siblings by
 * anything, and no amount of new data will change that.
 */
function reportUnidentifiable(item: unknown, common: Set<string>, owner: string): void {
  if (item === null || typeof item !== "object") return;

  for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
    // Nested values are compared by `valueEqual`, never counted as evidence.
    if (value !== null && typeof value === "object") continue;
    // Shared with a sibling, so it identifies neither of them.
    if (common.has(`${key}\u0000${String(value)}`)) continue;
    return;
  }

  diagnose("RMD051", owner, `A row rendered by ${owner} has no field that tells it apart from its siblings.`, {
    owner,
  });
}

const DISTINCT = 2;
const POSITIONAL = 1;

function overlap(a: unknown, b: unknown, aAt: number, bAt: number, common: Set<string>): number {
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return Object.is(a, b) ? DISTINCT : 0;
  }

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  let score = 0;
  for (const key of Object.keys(left)) {
    const value = left[key];
    if (value !== null && typeof value === "object") continue;
    // Shared by several rows, so it does not tell them apart. See `common`.
    if (common.has(`${key}\u0000${String(value)}`)) continue;
    if (!Object.is(value, right[key])) continue;

    // A match on a field that equals its own index on both sides is worth LESS,
    // not nothing. Both readings are real: `{ id, index, field }` has a field
    // that only restates the position, and `items.map((x, i) => ({ id: i }))`
    // has an identity that happens to look like one. Discarding it fixed the
    // first and broke the second — measured: editing the first row of an
    // id-as-index list rebuilt it and lost what its component held. Weighted, the
    // form row is decided by its `id` (a full match beats a positional one) and
    // the id-as-index row still has its half point when nothing else is left.
    score += value === aAt && right[key] === bAt ? POSITIONAL : DISTINCT;
  }
  return score;
}

/**
 * A cheap bucket key — enough to keep unrelated rows apart, never enough to say
 * two rows are the same row. `valueEqual` decides that.
 */
function signature(value: unknown): string {
  if (value === null || typeof value !== "object") return `p${String(value)}`;
  if (Array.isArray(value)) return `a${value.length}`;

  let out = "o";
  for (const key of Object.keys(value).sort()) {
    const field = (value as Record<string, unknown>)[key];
    out += `${key}=${field === null || typeof field !== "object" ? String(field) : "~"};`;
  }
  return out;
}
