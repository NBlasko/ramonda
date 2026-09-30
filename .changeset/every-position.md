---
"@ramonda/css": minor
---

Every form of a position now splits: `background-position` with three or four values and as a list
(`left 10px top 5px, center`), and `mask-position` and `-webkit-mask-position`, which did not split at
all. `mask-position` is written with the `-webkit-` longhands, the only names all three engines have.

And two values `background-position` split before are no longer split, because every engine refuses
them: `1px,` and `5 5`.
