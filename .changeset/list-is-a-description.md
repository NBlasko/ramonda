---
"@ramonda/core": patch
---

Reaching for a `list()` as if it were an array now says what it is.

`list(items, (item) => …)` reads exactly like `items.map((item) => …)`, and the one thing that differs is the thing you cannot see: it does not iterate there. Nothing has run when it returns — the callback is called by the framework while it reconciles the rows, which is what makes a list whose array did not change cost nothing.

Anyone expecting an array met `undefined`, `is not a function` and `is not iterable`, none of which say what happened. TypeScript refuses all three, so getting there means the types were bypassed; development now throws with an explanation and points at the two things that are right — render it, or use `.map()` if what you want is an array of values.

The docs say the same thing up front, since the shared shape makes the difference easy to miss.
