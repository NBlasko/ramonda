---
"@ramonda/css": minor
---

`supports-never-true`: a `@supports` condition that is false by a slip is reported — `(display: gird)`, `(displayx: grid)`, `(gap: 1)`, `(display grid)` with no colon, `selector(has(a))`, `selectorx(…)`. A word it does not know is left alone, because `@supports` exists to ask about what a browser may lack: `(display: masonry)` is a real question.
