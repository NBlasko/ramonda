---
"@ramonda/core": patch
---

Six form controls across the documentation site and the playground were named only by their
placeholder — an explanation that disappears the moment somebody types. Each now carries an
`aria-label` beside the placeholder, so the field says what it is for while it has something in it.

Found by `named-only-by-a-placeholder` on its first run.
