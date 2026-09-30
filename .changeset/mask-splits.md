---
"@ramonda/css": minor
---

`mask` now splits into its longhands, layer by layer, and resets the `mask-border` longhands too, as
WebKit's `mask` does. A box one engine refuses keeps the shorthand: no engine takes `margin-box` here,
and WebKit refuses `fill-box`, `stroke-box` and `view-box`.
