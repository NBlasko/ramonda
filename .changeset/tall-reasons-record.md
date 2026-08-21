---
"@ramonda/check": minor
---

Every finding can carry a written reason — not just the three module rules that asked for one.

`ramonda-check-ignore <why>` used to reach exactly three rules, because it was a method on
`ModuleContext` that each rule called for itself. Its own note said why that is the wrong shape — "a
guard every rule needs is a guard a rule can forget" — and thirty class rules were the ones who
forgot. So when a class rule was wrong there was no way out but restructuring correct code, and
`server-env-in-shared-code` is an ERROR: measured on this very branch, an aliased
`@created({ env: "server" })` stopped excusing a `process.env` read and the reader's only option was
to rewrite code that was already right.

It is applied where every family's findings already meet, in `collect`, so no rule can be the one
that did not ask. Class, element, tree, project and module rules all take it, and the reason is
recorded under the rule's own name — printed on every run, so it cannot quietly stop being true.

**An EMPTY directive now buys nothing.** It is reported, as it always was, and the finding stands.
`ramonda-check-ignore` with nothing after it used to silence the site and leave a note, which made
the note the price of switching a rule off. The package's own sentence is that a silence is not a
record, and a directive that records nothing has bought a silence with nothing. It matters more now
that the mechanism reaches every family: one worth abusing for thirty rules is not the same as one
for three.

`ModuleContext.unlessAnnotated` is gone, and with it the per-rule context `applyModule` built — the
reason for building one per rule was the annotation, and there is nothing left that varies.
