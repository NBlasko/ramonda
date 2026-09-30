---
"@ramonda/css": minor
---

A combinator in a block's selector is written spaced — `& > span`, `& + b`, `& ~ c` — as Prettier
writes CSS. `ramonda-css format` rewrites `&>span`, and `non-canonical-spelling` reports it until it
is formatted. Inside parentheses and brackets nothing changes: `:nth-child(2n+1)` and
`[class~="x"]` are left as they are.
