---
"@ramonda/css": minor
---

`-webkit-mask` is refused, as `resets-differ-across-engines`. Chromium and Firefox reset `mask-clip`,
`mask-composite` and `mask-mode` with it and WebKit keeps them, so the same line renders differently
in each — and no compiler can make it render one way. Write `mask`, which every engine has.
