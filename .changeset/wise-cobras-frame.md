---
"@ramonda/form": patch
---

The FORMS tab says which form a broken field belongs to

A form's row is followed by one row per field that is wrong, and those rows were **siblings** of the
summary rather than visibly inside it. With one form on the page that reads fine. With two, the second
form's `email` row sits directly under the first form's fields and reads as if it belonged to them —
there was nothing on screen tying a field to its form.

The rows were grouped in the data all along, one group per form; the group simply had no label, so the
panel had nothing to draw. It has one now, and only when there is more than one form — the same rule
`@ramonda/query` uses for its client label, because a header over the only group says nothing the row
beneath it does not.

Two tests, one on each side of the contract: that a second form gets its own labelled group whose label
names the form in its summary row, and — in `@ramonda/devtools` — that a labelled group is actually
drawn as a header above its own rows, in order. Nothing asserted the second half before, so the label
could have been ignored by the panel and the fix would have looked done.

Still open, and it needs a decision rather than code: a form is called `Form 1`, `Form 2`, because a
hook cannot see the component that used it. Core keeps the owner on its runtime for exactly this kind of
naming, but not as public API — so `SIGNUP` instead of `FORM 2` is a question about core's surface, not
about this tab.
