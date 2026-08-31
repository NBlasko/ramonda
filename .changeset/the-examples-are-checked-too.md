---
"@ramonda/check": minor
---

`analyzeProgram` — the same analysis, over a program you already have

`analyzeProject` reads a tsconfig and builds a program. The program IS the cost of a run — the
rules themselves are close to free — so a tool holding its own programs had to pay twice, and look
at something slightly different from what it had type-checked.

Written for `scripts/check-examples.mjs`, which now asks a second question of every documentation
example. It has always proved they COMPILE; it had never asked whether the example is one the
framework itself would report. That is how `reference/api.md` came to demonstrate the inline arrow
`RMD020` reports, with a green gate over it.

**And running it found a rule reporting its own advice.** `fresh-object-in-props` follows a call to
see whether a literal is built inside it, and skipped `@compute` because caching is the whole of
what it does — but not `@memoized`, which is the answer for a value built per ROW. So
`concepts/caching.md`, whose entire subject is `@memoized` as the fix for that report, was reported
by it. Both caching decorators are skipped now, and `unkeyable-memoized-argument` is what keeps the
assumption honest.

The examples the pass found and that are now fixed: three function literals in the markup
(`composition/lazy.md` twice, `composition/error-boundaries.md`), six form controls with nothing
naming them, a `<div>` with a click and no keyboard path, and two `<ul>…</ul>` elisions that are
not valid markup for anyone who copies them.
