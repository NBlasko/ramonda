---
"@ramonda/css": minor
---

A call that is never closed is named where it opens, instead of blaming the line below.

`content: url(;` is a missing `)`. The value scanner counts parens and a block's own closer is a `)`
like any other, so the value ran past `)}` and took the author's next line with it — and what they
were told was about that line:

```
`export const d = (1 + 2)` is not a declaration
reported on line 4, for a mistake on line 2
```

The new rule `unclosed-call` says which call is open, at the line and column it opens on. The strict
read carries the same sentence, because it refuses the block before any rule can speak.
