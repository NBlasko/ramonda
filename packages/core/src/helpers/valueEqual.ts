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
 * The bounds a DIAGNOSTIC compares with, and why they are not the ones above.
 *
 * The defaults are sized for `resolveStable`, which runs on the hot path, per declared prop, per
 * render — and which only has to CHOOSE a reference, so "different" past a bound costs it a fresh
 * one and nothing else. A diagnostic has to SPEAK: it tells an app that a value churns, or that a
 * prop is stale, and past a bound it would be saying so about contents it never looked at.
 *
 * Measured, and this is what makes it affordable: a diagnostic compares only a pair that is already
 * known to differ by reference, only in a development build, and only under the double render.
 *
 * The depth clears the shapes that were being reported for being deep — a JSX subtree in a props
 * bag, a nested record — and the width clears a table's worth of rows, which is where the array cap
 * was answering "different" for two arrays it had not compared at all.
 */
export const THOROUGH_DEPTH = 24;
const THOROUGH_WIDTH = 1000;

/** `valueEqual` with those bounds — the entry point for every caller that reports. */
export function valueEqualThorough(a: unknown, b: unknown): boolean {
  return valueEqual(a, b, THOROUGH_DEPTH, 0, THOROUGH_WIDTH);
}

export function valueEqual(
  a: unknown,
  b: unknown,
  maxDepth: number = DEFAULT_DEPTH,
  depth = 0,
  maxWidth: number = MAX_WIDTH,
): boolean {
  if (Object.is(a, b)) return true;
  if (depth >= maxDepth) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
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
    if (a.length > maxWidth) return false;

    for (let i = 0; i < a.length; i++) {
      if (!valueEqual(a[i], b[i], maxDepth, depth + 1, maxWidth)) return false;
    }
    return true;
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    if (aKeys.length !== Object.keys(b).length) return false;
    for (const key of aKeys) {
      if (!valueEqual(a[key], b[key], maxDepth, depth + 1, maxWidth)) return false;
    }
    return true;
  }

  return false;
}

export { isPlainObject };
