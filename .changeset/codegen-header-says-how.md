---
"@ramonda/css": patch
---

A generated `css-system/` file says how to regenerate it, on a second line under the first: edit
`ramonda.css.ts` and run `ramonda-css codegen`. Regenerate once to pick it up; `codegen --check`
reports the old header as out of date.
