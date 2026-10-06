---
"@ramonda/css": patch
---

**Setting a token is not a hardcoded value.** Under `hardcoded: false` (`variablesOnly` before),
`--color-surface: #111827;` — a token set to a value its `range` permits — was refused as a colour
written out, while the range said it may be. Setting a token is where a theme writes its colours; the
value is judged against the token's range instead, and an ordinary property is refused as before.
