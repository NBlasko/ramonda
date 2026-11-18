---
"@ramonda/core": patch
---

`@memoized` keeps calls with more than one argument apart whatever their strings hold: each argument goes into the
key with its length in front, so `pick("a|s:b", "c")` and `pick("a", "b|s:c")` no longer share one handler.
