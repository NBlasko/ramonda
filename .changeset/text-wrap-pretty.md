---
"@ramonda/css": patch
---

`text-wrap: pretty` is no longer split. Firefox does not have `pretty` and drops the declaration,
where a split still set `text-wrap-mode` there. It keeps its shorthand, so Firefox ignores it as it
would the same line written by hand — and it is not an error: one browser lacking a value is what
its author expects. The grammar generator now asks every word a family takes, which is how it was
found, and records such words as `partial`.
