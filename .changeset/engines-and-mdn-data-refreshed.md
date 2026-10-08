---
"@ramonda/css": patch
---

**The property map follows newer engines and `mdn-data`.** Fifteen properties are new — among them
`white-space-trim`, `text-fit` and the two halves of `timeline-trigger`,
`timeline-trigger-activation-range` and `timeline-trigger-active-range`, which split the way
`animation-range` does. The six `timeline-trigger-range` and `timeline-trigger-exit-range` names are
gone: no engine has them, and Chromium uses the new ones. `-webkit-border-after`, `-start` and `-end`
split into their own longhands, as `-webkit-border-before` already did. `column-rule-style` stays
`CssValue`: mdn-data now closes it over the ten line styles, and Chromium takes a list of them —
`solid, dashed`, `repeat(2, solid)` — so the engines are asked, and a property they take more than one
word for is never a union. The hover link of an at-rule points at MDN's current page.
