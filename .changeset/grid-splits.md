---
"@ramonda/css": minor
---

`grid`, `grid-template` and `mask-border` now split into their longhands. In the area form, line
names that meet between two rows become one set and a row with no size is `auto`, as every engine
reads it; area strings that do not make a rectangle keep the shorthand, since CSS drops them whole.

Every shorthand splits now, but `all` — which has a layer of its own — and `-webkit-mask`, which is
refused.
