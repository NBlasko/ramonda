---
"@ramonda/check": patch
---

Three findings from the branch's own review

Fresh code is the least-examined code on a branch, and this was a long one.

**Two exported `hostTagOf`s, in two files, with two answers.** `html.ts`'s follows a name to its
declaration; one added in `element.ts` accepted a string literal and nothing else — so
`@Host(PANEL_TAG, …)` resolved over there and not here, and every rule that turns on the tag went
quiet for it. There is one reader now, and the constant case is pinned.

**The tenth rule of a kind, missed by a sweep of nine.** `attribute-that-does-nothing` reports a
name the author WROTE — `httpEquiv` reaches the DOM as `httpequiv` whether it is on a tag or in a
`@Host` props bag — and nine rules of exactly that shape had been given the host while this one kept
reading the JSX node. Found by asking which element rules still read that node directly and why,
which is not visible from any rule's own text.

**Three exports nothing outside their own file used** — `narrowsTo`, `attributesOf`,
`hostAttributesOf`. An export is a promise, and this package curates its surface on purpose.

Measured against `main` over every fixture: **no finding lost**, once the three whose issue shape
gained an `onHost` field are matched to their replacements. Over the seven real projects here the
output is byte-identical to `main`'s. `apps/docs`, 155 components: 1.29 s on `main`, 1.38 s here.
