---
"@ramonda/check": minor
---

New rule: `presentation-role-on-focusable`

`role="presentation"` — and its synonym `none` — says the element is scaffolding: expose what is
inside it, not it. ARIA resolves the conflict when that cannot hold, and **a focusable element is
the case**: it keeps its implicit role and the presentational one is dropped. So the author asked
for the element to leave the accessibility tree and it did not, with nothing at build time and
nothing at runtime to say so.

What a reader gets is the shape the author was trying to avoid — they tab onto something announced
as a button, a link or a text box that was meant to be invisible scaffolding. Which of the two the
author wanted, the element gone or the element focusable, is not a question this can answer, and the
report says so rather than guessing.

Written from the spec's presentational role conflict resolution, and it shares `focusableByTag`
with `aria-hidden-on-focusable`, its sibling claim about the same element — the two have to agree
about what "focusable" means or the same `<summary>` is focusable to one and not the other.

**The boundary is drawn where the spec stops being uncontested.** That resolution has a second half
— a global `aria-*` on the same element also drops the role — and it is deliberately not reported.
`<div role="presentation" aria-label="…">` is written on purpose often enough that reporting it
would be reporting a tradeoff rather than a fault, and one member of that set makes it plainly
wrong: `aria-hidden="true"` takes the element out of the tree anyway.

A warning, matching the sibling: the page is not broken, the element keeps its default semantics,
and this is an intention that failed rather than markup that misleads.

Takes the family's spread guards: silent when
a spread could replace the role, and silent on a tag-focusable element that spreads at all, since
the spread may be carrying the `tabIndex={-1}` that settles it.

Also cleans five imports the branch's own refactors left unused — `ts` in `aria-with-no-subject`,
`unknown-aria-attribute` and `attribute-that-does-nothing`, `RuleContext` in
`persist-of-a-lossy-value`, and three element readers in `aria-hidden-on-focusable`. Found by the
gate's linter, which the earlier sweep had only been pointed at the files it already knew about.
