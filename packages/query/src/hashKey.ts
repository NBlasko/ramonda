import { warnOnce } from "./diagnostics";
import type { QueryKey } from "./types";

/**
 * Stands in for `undefined` inside a key.
 *
 * `JSON.stringify([undefined])` is `"[null]"`, so without this `["user", undefined]`
 * — the shape a key has while the id it needs has not arrived — hashes IDENTICALLY
 * to `["user", null]`, a legitimate query for "the user with no id". Two different
 * questions, one cache entry, and each renders the other's answer.
 *
 * A NUL byte leads the marker because a query key is built from ids, slugs and
 * page numbers; a string that literally contains one is not something this cache
 * has to tell apart from the absence of a value.
 */
const UNDEFINED = "\u0000undefined";

/**
 * Turns a key into the string the cache is indexed by.
 *
 * ## Why the hash has to be stable, and not just unique
 *
 * The server renders a query, and its data travels to the client in the hydration
 * blob. The client looks that data up by hashing the key AGAIN, in a different
 * process, on a different machine. If the two hashes disagree by so much as an
 * object's key order, the lookup misses: the client sees an empty cache, refetches
 * everything the server already fetched, and the SSR was for nothing — silently,
 * because a cache miss looks exactly like a cold start.
 *
 * So object keys are SORTED. `{ page: 1, tag: "a" }` and `{ tag: "a", page: 1 }`
 * are the same query, and two components writing the literal in a different order
 * must not split the cache in half.
 *
 * ## What may go in a key
 *
 * Anything JSON can carry: primitives, arrays, plain objects, `null`, and
 * `undefined` (see above). That is not a limitation invented here — hydration puts
 * the same constraint on `@state`, for the same reason: the key is part of what
 * crosses the wire. Everything else is reported by `assertStableKey` in DEV.
 */
export function hashKey(key: QueryKey): string {
  if (__DEV__) assertStableKey(key);

  return JSON.stringify(key, (_field, value) => {
    if (value === undefined) return UNDEFINED;
    if (!isPlainObject(value)) return value;

    // Sorted, so declaration order cannot split one query into two entries.
    const sorted: Record<string, unknown> = {};
    for (const objectKey of Object.keys(value).sort()) {
      sorted[objectKey] = value[objectKey];
    }
    return sorted;
  });
}

/**
 * A plain object, as opposed to an array or an instance of something.
 *
 * The prototype check is what separates `{ page: 1 }` from a `Date` or a `Map`.
 * Sorting the keys of those would produce `{}` — every one of them hashing the
 * same — so they are left for `assertStableKey` to report and passed through here
 * for `JSON.stringify` to handle as it always does.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Deduped by MESSAGE: the same bad key shape is one problem, however many times it is hashed. */
/**
 * Walks a key and reports anything whose hash is not stable, or not unique.
 *
 * **A walk of its own, rather than a check inside the replacer**, and that is not
 * a stylistic choice: `JSON.stringify` calls a value's `toJSON()` BEFORE handing it
 * to the replacer, so a `Date` reaches the replacer already flattened to an ISO
 * string and is indistinguishable from someone passing that string on purpose.
 * Measured — the first version of this check never fired for a Date, which is the
 * case most likely to occur.
 *
 * DEV only. Production hashes the key anyway: on a live page a wrong render beats
 * a thrown one, and this reports a mistake in the code rather than a bad input.
 */
function assertStableKey(value: unknown, depth = 0): void {
  // Guards against a cyclic key, which would otherwise recurse until the stack
  // gives out — with an error naming neither the key nor this function.
  if (depth > 10) return;

  if (Array.isArray(value)) {
    for (const part of value) assertStableKey(part, depth + 1);
    return;
  }

  const kind = typeof value;

  if (kind === "function" || kind === "symbol") {
    warnOnce(
      `[RMQ001] A query key contains a ${kind}, which JSON.stringify drops — so two keys holding ` +
        `different ${kind === "function" ? "functions" : "symbols"} hash IDENTICALLY, share one cache entry, and each ` +
        `renders the other's data. Keys must be JSON-serializable: put the value you were going to close over in the ` +
        `key ("user", id) and keep the function in the fetcher.`,
    );
    return;
  }

  if (kind !== "object" || value === null) return;

  if (isPlainObject(value)) {
    for (const part of Object.values(value)) assertStableKey(part, depth + 1);
    return;
  }

  const name = (value as object).constructor?.name ?? "object";
  warnOnce(
    `[RMQ001] A query key contains a ${name}, which is not stable to hash. A Date serializes to a timestamp that ` +
      `differs on the next render, so the entry is never found again and every render refetches; a Map or a class ` +
      `instance serializes to whichever of its fields happen to be enumerable, which is often nothing at all. Put a ` +
      `primitive in the key — date.toISOString().slice(0, 10), or the id — and keep the object in the fetcher.`,
  );
}

/**
 * Kept as a named re-export: the dedup set now lives in `diagnostics.ts`, shared with
 * RMQ002, so a test that resets one code's reports resets them all rather than leaving the
 * other's set primed from an earlier case.
 */
export { resetQueryDiagnostics as resetKeyDiagnostics } from "./diagnostics";

/**
 * Whether two keys are equal PART BY PART, by identity — no hashing, no allocation.
 *
 * The cheap half of change detection. A key is a literal the props callback rebuilds
 * on every owner render, so its identity always differs while its value almost never
 * does; this answers the common case without touching `JSON.stringify`.
 *
 * **It only ever answers "definitely the same".** A `false` means "the parts are not
 * the same objects", which for two freshly built `{ page: 1 }` literals is true and
 * uninteresting — so a caller that gets `false` still has to hash to find out. That
 * is why this is not called `keysEqual`: it is a filter, not a verdict.
 *
 * Measured per render, for one query (Node 24, 200k iterations):
 *
 * ```
 *                          hash every render   this filter first
 *   ["user", 42]                     723 ns           31 ns
 *   ["a", "b", 1, true, 99]         1037 ns           38 ns
 *   ["posts", { page: 1 }]          1508 ns         1762 ns
 *   a key that really changed        759 ns          792 ns
 * ```
 *
 * A key containing an object pays ~250ns more, because the filter cannot decide and
 * the hash runs anyway. That is the trade taken deliberately: primitive keys are the
 * overwhelming majority (an id, a page number, a slug), and they get 20-30× cheaper.
 * In a development build the saving is larger still — hashing also runs
 * `assertStableKey`, a recursive walk that now happens only when the key moves.
 */
export function sameKeyParts(a: QueryKey, b: QueryKey): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    // `Object.is` rather than `===` so `NaN` matches itself, and `0`/`-0` do not.
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}

/**
 * Whether `key` starts with `prefix` — the relation `invalidate(["user"])` uses to
 * reach `["user", 1]` and `["user", 2]` without touching `["posts"]`.
 *
 * Compared part by part through the same hash, so a prefix containing an object
 * matches by value rather than by identity: `invalidate(["posts", { page: 1 }])`
 * finds the entry a component created with a freshly built literal. Comparing with
 * `===` would have matched nothing at all — every render builds a new object.
 */
export function keyStartsWith(key: QueryKey, prefix: QueryKey): boolean {
  if (prefix.length > key.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (hashKey([key[i]]) !== hashKey([prefix[i]])) return false;
  }
  return true;
}
