---
"@ramonda/css": patch
---

**An esbuild stylesheet no longer carries the path of the machine that built it.** esbuild heads
each module's CSS with a comment naming it, and a block's sheet was named by its absolute path, so an
unminified build shipped `/Users/<name>/…` to every visitor. The name is relative to the build's
working directory now.
