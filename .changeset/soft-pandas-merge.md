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

The property is `configurable: true` for this, and the trade is smaller than it sounds. `writable: false`
still refuses an assignment — the door an app could actually reach — and the symbol is a plain
`Symbol("stableProps")`, neither exported nor `Symbol.for`, so nothing outside the package can name it
without walking `getOwnPropertySymbols`. What is given up is a deliberate `defineProperty` by code that
went looking for it.
