---
"@ramonda/core": patch
---

A diagnostic about a component whose class has no name now names something

A class expression assigned to nothing has a `constructor` whose `name` is the empty string, and
`displayName` answered that empty string. Its own note said `??` could not become `||` "without
changing "" into Unknown" — and never asked whether any caller wanted `""`. None did: every one
either interpolates it into a sentence or puts it in a dedup key.

Measured, on the one code in the family a nameless class can actually reach:

    [RMD060] render() is async
    < />'s `render()` is async — it returns a promise, not markup.

A subject that reads as a syntax error rather than a name. It says `<Unknown />` now.

**The other direction was worse, and it was a lie rather than a gap.** `renderPhase`,
`hydrationMismatch`, `jsxRules` and `lintChildren` each distinguish "no component at all" — `outside
a render`, `root`, `A render`, `the root` — from a component, and `??` handed the nameless one the
word for NO component. So a report said the markup belonged to nobody about a component that was
right there, and every nameless component shared that group's dedup key: two of them with the same
duplicate key reported once between them.

Also corrected: the devtools panel labelled a nameless component's row and a nameless hook's row
with the empty string; `<tag>` in RMD039 was empty when a COMPONENT was the one given `class`; a
list's rows reported "Two rows rendered by ."; and `hydration/serialize.ts`'s fallback word was
ungrammatical in the case `??` did catch — `holds a object` is now `holds a class instance`.

Nine mechanisms, each proven by putting the `??` back and watching the suite fail. Three sites are
changed for uniformity and say so where they stand rather than looking finished: two cannot be
reached at all, and one is a shape I could not construct — the test written for it passed with the
operator changed back, so it was deleted rather than kept.

Found by unioning both coverage runs: three of core's four thinnest files by branch coverage had the
same unhit branch, and it was this one.
