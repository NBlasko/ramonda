---
"@ramonda/css": patch
---

Fixes from a third review, in what splits and what keeps its shorthand:

- A keyword in any case splits beside names of the author's own: `grid-column: SPAN 2`,
  `font: BOLD 12px serif`, `container: card / Inline-Size`. A name keeps its case, a grid line
  name in brackets too: `[None]` is not `[none]`.
- `scroll-margin`, `scroll-margin-block` and `scroll-margin-inline` split a value of several
  lengths. A value with a percentage keeps the shorthand, since these families take none.
- `position-try` splits a list of fallbacks, `--a, --b`, with the order on the first item only.
- A value with an empty item, `transition: 1s,` or `1s,,2s`, keeps its shorthand. It is invalid
  CSS, and it was split as if the empty item were not there.
