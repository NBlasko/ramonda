---
"@ramonda/core": minor
---

A number field keeps a number typed on its way: `-` before `-3`, `1e` before `1e5`

The browser reports `""` for text it cannot read as a number yet, so a model that follows the field holds
`""` — what the field already says. The render that followed wrote `""` back and took the `-` away, so
typing `-3` gave `3`. An `<input>` that already shows its model is not written now, as `TextArea` and a
settling field already were not.
