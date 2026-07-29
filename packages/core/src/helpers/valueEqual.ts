/**
 * Equal by CONTENT, to a bounded depth — the comparison behind both `stable()` and
 * RMD020's "this was rebuilt in place" finding.
 *
 * Shared rather than duplicated because the two need to agree: `stable()` reuses the
 * previous reference exactly when this says the contents match, and the diagnostic calls
 * a differing pair "rebuilt" exactly when it says the same. If they drifted apart, the
 * fix a report suggested would not silence the report.
 *
 * **Bounded in both directions** because it runs on every render in a development build,
 * and inside `stable()` in every build. Past the depth or the width, two different
 * objects are simply called different — which is always the safe answer: for `stable()`
 * it means a fresh reference (correct, just not optimal), and for the diagnostic it means
 * a finding is missed rather than invented.
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
    const width = Math.min(a.length, MAX_WIDTH);
    for (let i = 0; i < width; i++) {
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
