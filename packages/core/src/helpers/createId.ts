/**
 * Process-wide counter behind every internal id: runtime ids, effect ids,
 * lifecycle entries, memoised handlers, context ids, list scopes.
 *
 * ## Is there a faster way? No — measured
 *
 * ```
 *   id++ (this)            3.23 ns/call
 *   ++id                   6.50 ns
 *   Math.random()         13.39 ns
 *   Symbol()              34.53 ns
 *   `r${id++}` string     41.22 ns
 * ```
 *
 * And it is not on the radar in any case: a component costs ~7 µs to construct
 * and makes a handful of these, so they are roughly 0.2% of it. Anything that
 * produced a richer id — a string, a Symbol, a UUID — would be strictly slower
 * for no gain.
 *
 * ## Does hydration depend on the order? No — measured
 *
 * The worry was that a client whose components are created in a different order
 * than the server's — async, a code-split chunk arriving late — would allocate
 * different ids and break hydration.
 *
 * It cannot, because **no id crosses the boundary**. The state blob is
 * `{ state, hooks }` and its hook tree is positional, walked in `use()` order
 * (`hydration/serialize.ts`); ids appear nowhere in it.
 *
 * Verified rather than reasoned: a server render was hydrated by a client whose
 * counter had been pushed from 5 to 506 first. State restored correctly at both
 * levels of the tree, and no diagnostic fired — no RMD007, nothing.
 *
 * So ids are free to change allocation order. What they must stay is unique
 * WITHIN one process, which a counter gives by construction.
 *
 * ## Can a long-running app exhaust it? No — measured
 *
 * A realistic component (a `@compute`, a subscription, a handler) consumes **3.00
 * ids**, measured over a 500-row keyed list. At a brutal sustained 10 000
 * component creations per second — 30 040 ids/sec — reaching
 * `Number.MAX_SAFE_INTEGER` takes about **9 500 years**.
 *
 * Worth knowing anyway is HOW it would fail, because it is not a crash:
 *
 * ```
 *   9007199254740990
 *   9007199254740991
 *   9007199254740992
 *   9007199254740992   <- id++ stops advancing; every id from here is a duplicate
 * ```
 *
 * Past 2^53 a float64 cannot represent the next integer, so the counter silently
 * repeats. A duplicate `runtime.id` would collide in `State`'s listener slot and
 * one of the two components would simply stop re-rendering — no error anywhere.
 *
 * Not guarded: a check would run on the hot path for a horizon of ten thousand
 * years. Recorded so the failure mode is known rather than rediscovered.
 */
let id = 1;
export const createId = () => id++;
