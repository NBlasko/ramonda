---
"@ramonda/css": patch
---

`padding: VAR(--p)` is no longer split. CSS function names ignore case, so it is a `var()`, and a
split of one sets every longhand to a value that is invalid when the variable holds two: with
`--p: 4px 8px` the page got `0px` where CSS gives `4px 8px`. Only the lower-case spelling was refused
before.
