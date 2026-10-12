---
"@ramonda/css": minor
---

Four kinds of CSS every browser drops are reported now:

- `invalid-hex-color`: `#abcx`, `#ab` — a hex colour needs 3, 4, 6 or 8 hex digits.
- `malformed-media-condition`: `(min-width 40rem)` with no colon, `(min-width: 4r0em)`, and a word between conditions that is not `and`, `or` or `not`.
- `unknown-media-feature` now reads the range form too: `(400px <= wdith <= 70rem)`.
- `malformed-selector`: `&not(.a)` with its colon missing, `:nth-child(2+1)`, and a `[` left open.
