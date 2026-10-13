---
"@ramonda/css": minor
---

`invalid-value` reads the arithmetic inside `calc()`, `min()`, `max()` and `clamp()` for its type — `calc(100 - 2rem)`, `min(100%, 40)`, `calc(2px * 3px)`, `calc(1px+2px)` are reported — and a family name that begins with a generic family, `font-family: system-ui sans-serif`. `supports-never-true` asks the grammar too, for a value with no word in it: `(color: rgb(1x 2 3))`.
