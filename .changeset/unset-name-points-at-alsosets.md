---
"@ramonda/css": patch
---

The message for a custom property nothing sets points at a key that accepts it.

It offered four ways to fix a `var(--name)` nothing sets, and one of them was *add it to `variables`
in `ramonda.css.ts`*. That key became the declarations `$` is built from and refuses a bare list, so
an author following the advice was told *that was its old meaning … those go in `alsoSets` now* —
the tool sent them somewhere that turned them away, and the refusal did the teaching the message was
already trying to do.
