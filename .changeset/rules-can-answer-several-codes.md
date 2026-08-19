---
"@ramonda/check": patch
---

`alsoReportedAs` is a list, and three rules now declare the codes they had only ever named in prose.

`duplicate-decorators` answers **four** — a single-use decorator written twice is `RMD045`,
`RMD032`, `RMD040` or `RMD046` depending on which decorator it was, because what the framework does
about each differs: `@Host` throws, the middle two silently pick a winner, `@StableProps` merges. It
declared none, because the field held one string. `state-written-while-rendering` also answers
`RMD018` (the same write inside a `@compute`), and `row-without-a-key` also answers `RMD051` (the
`list()` half, where an identity was inferred and could not tell the row from its siblings).

So the reference linked neither way for six codes: the rule table did not name them, and a reader
arriving from the diagnostics page had no way to learn a static check existed. Found by grepping
every rule for the codes it mentions and comparing that against what it declares.

The catalogue test grew a second half with it: **no code may be claimed by two rules**, so a reader
who looks one up finds exactly one static check to read. `RMD023` is the single deliberate exception
and a real pair — `row-without-a-key` reports a row with no key at all, `index-as-key` one whose key
says only where the row was.
