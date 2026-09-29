---
"@ramonda/css": minor
---

`ramonda-css check` and the editor now report `narrower-after-a-whole-shorthand` across blocks too:
a block spreading one that sets `border: var(--x)` and then writing `border-top: var(--y)`, whether
the spread block is in the same file or another, and the same two blocks passed to
`mergeClassNames`. The compiler could only see it inside one block, and the merge only warned in
development.
