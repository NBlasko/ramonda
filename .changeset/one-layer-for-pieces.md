---
"@ramonda/css": minor
---

A split's pieces are in one layer, `ramonda.p`, instead of `ramonda.d1` beside seven empty ones kept
in reserve. A split always reaches the longhands, and a test holds that for every family; the
reserve guarded against something the test already forbids. `p` is also easier to read in devtools
than a `d1` among the breakpoint digits `d0`…`d9`.

And `-webkit-mask` is gone from the types, so an editor no longer offers it. Writing it is still an
error that names `mask`.
