---
"@ramonda/css": minor
---

A shorthand whose value holds a `var()` now goes in its own layer, `ramonda.v`, instead of a layer
named by how many longhands it covers. Such a shorthand can never split, and a count can move when
CSS adds a longhand to the family — so a package built before that would have named a different
layer. A word does not move.

`v` sits above the counted shorthands and below the split pieces and the longhands you write. One
order it cannot keep, and the build now refuses it as `narrower-after-a-whole-shorthand`: a narrower
shorthand written after a wider one holding a `var()`, like `border: var(--x)` then
`border-top: var(--y)`. Across two blocks, where the compiler cannot see both, the merge says so in
development.
