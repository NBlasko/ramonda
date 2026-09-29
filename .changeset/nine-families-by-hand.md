---
"@ramonda/css": minor
---

Nine more shorthands split into their longhands: `flex`, `white-space`, `grid-area`, `font-synthesis`,
`marker`, `contain-intrinsic-size`, `text-box`, `-webkit-text-stroke` and `-webkit-border-before`.
Neither learned table could answer them — `white-space: pre` stands for two longhands at once,
`font-synthesis: weight` switches one on, `grid-area: a` copies a name into the lines left out — so
their rules are written out by hand, and every value is checked against Chromium, Firefox and WebKit.

A value one engine refuses keeps its shorthand, since CSS drops the whole declaration there and a
split would not: `text-box: cap`, which Chromium refuses, and `font-synthesis` with `position`.
