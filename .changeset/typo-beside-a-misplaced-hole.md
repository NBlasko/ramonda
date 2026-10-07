---
"@ramonda/css": patch
---

**A misplaced hole no longer hides a misspelt property elsewhere in the block.** In the editor and
in `ramonda-css check`, `$(name): 24px;` beside `colr: red;` reported the hole and not `colr`: every
`unknown-property` in the block was dropped while a hole was out of place. The name holding the hole
never needed that — it is not one word, so the rule passes it by — and `colr` is reported now.
