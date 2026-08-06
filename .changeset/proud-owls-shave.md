---
"@ramonda/core": patch
---

`valueEqual`'s bounds are documented as what they are

The header said the comparison was "bounded in both directions". Depth is bounded everywhere, but
width is bounded for ARRAYS only — a wide plain object was, and still is, compared key by key.

The asymmetry is right, and the measurements say why: a 100-key object compares in 3.33 µs and 50-key
objects nested to the depth `@StableProps` uses in 8.48 µs, while capping them would call a form's
record "different" on every render, hand `@StableProps` a fresh reference and re-render the child
every time — the thing it exists to prevent. A wide array, by contrast, is usually a fresh array
anyway, and answers in 0.07 µs at the bound.

So the comment now describes the code, with the numbers behind the choice, and `ValueEqual.test.ts`
pins both sides of it so the asymmetry stays a decision rather than an oversight.
