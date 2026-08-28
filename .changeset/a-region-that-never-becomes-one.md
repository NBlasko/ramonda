---
"@ramonda/check": minor
---

New rule: `region-with-no-name` — a landmark declared and never exposed

`region` is the one landmark role the specification makes conditional on a name. WAI-ARIA is
explicit — *authors MUST give each element with role `region` a brief label* — and an unnamed one
is not put in the landmark list at all. The element is a generic box, exactly as it would have been
with no `role` typed on it.

That is an intention that failed rather than markup that misleads, and it is invisible: nothing on
the page looks wrong, nothing ever will, and the attribute the author wrote does nothing.

**A bare `<section>` is NOT this report.** `<section>` maps to `region` only when it has a name and
to `generic` when it does not — the mapping working as designed. Reporting it would report ordinary
correct markup on nearly every page ever written. The line is the WRITTEN role: typing
`role="region"` is asking for a landmark.

Silent on a role it cannot read, on a role chain whose winner is not a question about this element,
on a name it cannot read (somebody naming it), and on a spread that may be carrying the name.

**`landmarks-that-cannot-be-told-apart` gives `region` up.** It fires only when NEITHER of two
landmarks of a kind is named — which for `region` is exactly the case where neither IS a landmark.
Measured on a plant: both rules named the same two lines, and only one of them was saying something
true. One fault, one report.
