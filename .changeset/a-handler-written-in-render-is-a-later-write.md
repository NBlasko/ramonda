---
"@ramonda/check": patch
---

`cached-read-of-a-plain-field` and `row-reads-a-plain-field` count a write made by a function written
inside the constructor, `@created` or `render()` — a handler `render()` hands an element, a timer
`@created` starts, a listener the constructor adds. Those run later, so a `@compute` or a row that read
the field holds a stale value; the members' own writes still count as the starting value or the memo
pattern.
