---
"@ramonda/core": patch
---

`RMD046` — two `@StableProps` on one class merge instead of throwing

It used to throw, and not on purpose: `STABLE_PROPS` was written non-configurable, so the second
`defineProperty` failed with V8's `Cannot redefine property: Symbol(stableProps)`. An internal symbol and
no advice, for what is a spelling mistake.

Merging is the reading that matches the decorator. `@StableProps` names a **set**, and it already merges
along the class chain — a subclass adds names rather than shadowing the base's — so two on one class has
one unambiguous reading, the union, and both declarations now take effect. Combine them into
`@StableProps("a", "b")`.

**A warning rather than a refusal**, which is the line against `RMD045`: two `@Host` element names have no
union, so carrying on there would mean silently picking one. Here the result is exactly what was asked
for, so only the spelling is redundant.

The property is `configurable: true` for this. `writable: false` still refuses assignment; what it gives
up is protection against a deliberate `defineProperty` by an app, which nobody had named as a threat.
