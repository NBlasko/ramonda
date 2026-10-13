---
"@ramonda/css": minor
---

Three silent drops are reported now:

- `@media (min-width: 40remx)`: a unit no engine has leaves the condition kept and never matching (`unknown-media-value`).
- `width: d(10px)`: a function CSS does not have, so the declaration is dropped (`unknown-function`).
- `width: --double(10px)` and `@function`: CSS custom functions, which Firefox drops (`custom-function`). `@function` was reported as an at-rule CSS does not have, which was false.
