---
"@ramonda/css": patch
---

Fixes from a second review:

- The development warning about conditions compares an important declaration with other important
  ones only. It skipped every important declaration with no condition, and compared one with an
  ordinary declaration, where importance decides.
- `narrower-after-a-whole-shorthand` across blocks: a pair inside one block after a spread is
  reported once, a block spread twice counts twice, and after an `if` group the check stops rather
  than guess where the group ends. At a `mergeClassNames` call it is told only for a wider shorthand
  an earlier argument left.
- `allow-list-not-css` no longer calls a value "not CSS" when it could not be read as one value.
