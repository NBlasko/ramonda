---
"@ramonda/css": patch
---

**A `match` over a number or a boolean says what to write instead.** It was refused with a raw
`Type 'string' is not assignable to type '2 | 1'`, once per key, naming neither `match` nor the fix.
It is now refused once, on the subject: `match takes a string — for a boolean, write $(on) ? a : b`,
or `— name the cases in code, $(n > 2 ? 'large' : 'small')`. An arm's key is a written word, so
`match` takes a string; nothing that worked before changes.
