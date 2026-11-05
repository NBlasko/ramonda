---
"@ramonda/check": patch
---

`ramonda-check-bundle` walks each folder once. It followed links, so a folder linking back to itself — a symlinked folder in `public/`, copied into the build as a link — was walked `loop/loop/…` until the system refused, and the build failed with ELOOP.
