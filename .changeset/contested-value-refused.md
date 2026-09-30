---
"@ramonda/css": minor
---

`animation: auto` is refused, as `value-differs-across-engines`. Firefox reads `auto` as the animation's
name and Chromium and WebKit put it in no longhand at all, so the same line renders differently in
each. Set the longhand you mean.
