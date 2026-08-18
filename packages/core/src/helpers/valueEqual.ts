/**
 * Equal by CONTENT, to a bounded depth — the comparison behind both `@StableProps` and
 * RMD020's "this was rebuilt in place" finding.
 *
 * Shared rather than duplicated because the two need to agree: `resolveStable` reuses the
 * previous reference exactly when this says the contents match, and the diagnostic calls
 * a differing pair "rebuilt" exactly when it says the same. If they drifted apart, the
 * fix a report suggested would not silence the report.
 *
 * **Depth is bounded everywhere; width is bounded for ARRAYS only.** Past a bound, two
 * different values are simply called different — the only safe answer: for `@StableProps`
 * it means a fresh reference (correct, just not optimal), and for the diagnostic it means
 * a less precise message rather than a change that was never noticed.
 *
 * The asymmetry is deliberate, and it used to be described here as "bounded in both
 * directions", which was not what the code did. A wide ARRAY is the shape a list of rows
 * takes, it is usually a fresh array anyway, and stopping at the bound costs nothing worth
 * measuring. A wide OBJECT is a record — a form's fields, a config — whose keys are fixed
 * and whose contents genuinely do repeat between renders, so calling it "different" past a
 * cap would hand `@StableProps` a fresh reference on every render and re-render the child
 * every time: the exact thing it exists to prevent, traded for speed that is not needed.
 *
 * Measured, per call: a 10-key object 0.35 µs, 50 keys 1.51 µs, 100 keys 3.33 µs, and 50-key
 * objects nested to the depth `@StableProps` uses 8.48 µs. Only a 500-key object gets
 * expensive (62 µs), and that is not a props shape. An array over the bound answers in
 * 0.07 µs, which is what the cap buys where it applies.
 *
 * Depth counts structural recursion only. Primitives compare by `Object.is` before the
 * bound is consulted, so `["posts", { page: 1 }]` matches at the default depth.
 */
const DEFAULT_DEPTH = 2;
const MAX_WIDTH = 50;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Records that a verdict was reached AT a bound rather than by comparing to the end.
 *
 * "Different" past a bound is the safe answer for a caller that has to CHOOSE — `resolveStable`
 * hands back a fresh reference, which is correct and merely not optimal. It is not a safe answer
 * for a caller that has to SPEAK: RMD027 tells an app one of its values is stale, and a comparison
 * that stopped early has established no such thing. Those callers pass this and stay quiet when it
 * comes back hit.
 */
export interface Bound {
  hit: boolean;
}

export function valueEqual(
  a: unknown,
  b: unknown,
  maxDepth: number = DEFAULT_DEPTH,
  depth = 0,
  bound?: Bound,
): boolean {
  if (Object.is(a, b)) return true;
  if (depth >= maxDepth) {
    if (bound) bound.hit = true;
    return false;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    // A length that differs is a difference, proven — the bound had nothing to do with it.
    if (a.length !== b.length) return false;
    /**
     * Past the width, "different" — the same answer the depth bound gives, and for the same reason.
     *
     * This used to compare the first `MAX_WIDTH` items and then answer TRUE for the rest, which is a
     * verdict on a sample: two sixty-item arrays differing only at index 55 compared as equal, so
     * `@StableProps` handed the previous one back and the change was gone with nothing reported.
     * Measured on `@ramonda/form`, where the prop carries a record rather than a cache key.
     *
     * Erring toward "different" costs a fresh reference for a wide array — correct, just not
     * optimal, which is what the bounds were always documented to cost.
     */
    if (a.length > MAX_WIDTH) {
      if (bound) bound.hit = true;
      return false;
    }

    for (let i = 0; i < a.length; i++) {
      if (!valueEqual(a[i], b[i], maxDepth, depth + 1, bound)) return false;
    }
    return true;
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    if (aKeys.length !== Object.keys(b).length) return false;
    for (const key of aKeys) {
      if (!valueEqual(a[key], b[key], maxDepth, depth + 1, bound)) return false;
    }
    return true;
  }

  return false;
}

export { isPlainObject };
