/**
 * Structural sharing for the cache, which now lives in `@ramonda/core`.
 *
 * It moved because it stopped being a cache concern. Keeping the previous value
 * where the new one is equal is what lets `list()` recognise a row across a
 * refetch, so the two belong together — and every app gets the same function,
 * with the same bounds, whether its data came through a query or not.
 *
 * `merge` also takes an identity callback that this does not pass. A cache has no
 * business deciding which row is which; the app does, and it says so where it
 * hands the data on. See `merge`.
 */
export { merge as replaceEqualDeep } from "@ramonda/core";
