---
"@ramonda/core": patch
---

A controlled field keeps its caret when the model rewrites in place

Assigning `.value` drops the caret to the end of the field. That is the platform, and for most
writes it never shows: a value only reaches the writer when it DIFFERS from what the element holds,
so a model that echoes back what the reader typed writes nothing and the caret is untouched.

What was left is a model that REWRITES — `toUpperCase()`, a mask. The reader clicked into the middle
of the text and the next keystroke landed at the end. Measured: `axbc` uppercased to `AXBC`, caret
at 4 rather than 2.

The caret is restored when the rewrite left the LENGTH unchanged, because then every offset still
means the position it meant. When the length changed it is not: after `123` becomes `1,234` the old
offset points between the separator and the `2`. Placing it there would be a guess, and deciding
where it really belongs needs to know which characters are separators — the app's knowledge, not the
framework's. An app that formats reads `selectionStart` in `@updated` and applies its own rule.
