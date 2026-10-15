---
"@ramonda/core": patch
"@ramonda/check": patch
---

The advice for a value built per item no longer goes in a circle. RMD020 said a `@compute` cannot help per item and sent the reader to `@memoized`; called with the item, `@memoized` was then refused by RMD047, because an object is no cache key. RMD020 now says to call `@memoized` with the item's id and read the item inside, or to build every item's value in one `@compute` keyed by id — and RMD047 and `unkeyable-memoized-argument` name the same `@compute`, so neither is a dead end.
