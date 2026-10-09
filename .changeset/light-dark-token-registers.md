---
"@ramonda/css": patch
---

**A token written as `light-dark(light, dark)` stays registered on Vite 8.** Vite 8 minifies CSS
with lightningcss, which rewrites the pair into `var()`s — inside the token's `@property`
registration too, and a browser refuses an `initial-value` that holds a `var()`. Measured on a
Vite 8 build: every such token unregistered in Chromium, Firefox and WebKit, so a value of the wrong
kind was no longer caught. The registration's `initial-value` is now the light half, which is what
the engines resolved the pair to there anyway; `:root` keeps the pair, and the page follows the
reader's scheme as before.
