---
"@ramonda/css": patch
---

**A declared variable set in a block is checked against its declaration**
(`token-set-against-its-declaration`). One declared without a `range` never changes — its type
says `Fixed<…>` and `toStyle` already refused to set it — so `--color-surface-sunken: red;` in a
block is refused too, naming the variable and how to give it a range. One with a `range` may only be
set to a value in it, branch by branch for a choice or a match.

The same check covers the two other places a theme sets a variable: **a project stylesheet** — the
Vite and esbuild plugins stop the build at the file and line — and **a `style` attribute**, in the
editor and `ramonda-check`. The generated `variables.css` is left alone.
