---
"@ramonda/css": patch
---

A block the parser gives up on no longer hides every other file's faults.

`ramonda-css` stops type-checking when it cannot read a block, and the reason is right: with no
virtual file for that module, the compiler's word about anything is confusion about a file it could
not read. But that reason was applied to the whole project — one unclosed `url(` in one file hid a
misspelt property in another that had parsed perfectly, so a typo anywhere meant fixing a repository
one error per run.

The CSS rules that ran over files which read are reported now, under a heading of their own, after
the refusal. The compiler's own diagnostics stay out, which is what the reason is about, and the
file that failed still contributes nothing — its walk stopped before it found anything.

```
[ramonda-css] 1 block(s) could not be read, so nothing was type-checked:

  src/Card.tsx:2:12
    `url(` is never closed — it needs a `)`.

[ramonda-css] and 1 problem(s) in files that read:

  src/Other.tsx:2:3
    unknown-property: `colour` is not a CSS property. Did you mean `color`?
```
