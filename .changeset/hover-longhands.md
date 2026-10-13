---
"@ramonda/css": patch
---

Hovering a shorthand's value in the editor shows the longhands it is written as — `border-left: 4px solid currentColor` is `border-left-width: 4px`, `border-left-style: solid`, `border-left-color: currentColor` — and, for a value with a `var()`, that it is kept whole and why.
