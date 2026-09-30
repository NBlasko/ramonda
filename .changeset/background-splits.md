---
"@ramonda/css": minor
---

`background` now splits into its longhands, layer by layer: `url(a.png) center / cover no-repeat, red`
is a list for each longhand and one `background-color`. Checked against Chromium, Firefox and WebKit
over forty values, each after every other.
