---
"@ramonda/css": patch
---

`supports-a-media-feature` no longer reports `@supports (height: 100dvh)` or `(width: 1cqi)`: a newer unit is the question itself — that is how a page asks whether `dvh` is there. Only a unit every engine has had for years, `@supports (min-width: 40rem)`, makes the condition always true and is reported.
