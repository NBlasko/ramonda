/**
 * Equal by CONTENT, to a bounded depth — the comparison behind both `@StableProps` and
 * RMD020's "this was rebuilt in place" finding.
 *
 * Shared rather than duplicated because the two need to agree: `resolveStable` reuses the
 * previous reference exactly when this says the contents match, and the diagnostic calls
 * a differing pair "rebuilt" exactly when it says the same. If they drifted apart, the
 * fix a report suggested would not silence the report.
 *
 * **Bounded in both directions** because it runs on every render in a development build,
 * and for every declared prop in every build. Past the depth or the width, two different
 * objects are simply called different — which is the only safe answer: for `@StableProps`
 * it means a fresh reference (correct, just not optimal), and for the diagnostic it means
 * a less precise message rather than a change that was never noticed.
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

export function valueEqual(a: unknown, b: unknown, maxDepth: number = DEFAULT_DEPTH, depth = 0): boolean {
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
    if (a.length > MAX_WIDTH) return false;

    for (let i = 0; i < a.length; i++) {
      if (!valueEqual(a[i], b[i], maxDepth, depth + 1)) return false;
    }
    return true;
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    if (aKeys.length !== Object.keys(b).length) return false;
    for (const key of aKeys) {
      if (!valueEqual(a[key], b[key], maxDepth, depth + 1)) return false;
    }
    return true;
  }

  return false;
}

export { isPlainObject };
