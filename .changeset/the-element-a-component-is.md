---
"@ramonda/check": minor
---

The accessibility rules now read the element a component IS, not only the tags it writes

`@Host("section", () => ({ role: "buton" }))` puts a role on a real element on a real page, and it
appears in no render. The element family only ever met TAGS. Measured with a plant — five faults
written in a props bag, **zero reported**, against the identical five on a `<div>` one class below
with all five reported. That is where a component configures its own element, and a rule that reads
elements and misses it is reading half of them.

Nine rules answer for a host now: `unknown-role`, `unknown-aria-attribute`, `aria-with-no-subject`,
`aria-value`, `role-takes-no-name`, `role-missing-required-aria`, `positive-tabindex`, `access-key`
and `class-instead-of-classname`. A rule opts in with `alsoOnHost`, and only where its question has
an answer: a host has attributes, and it does not have children a rule can read or a parent one can
name.

The fix is one reader rather than nine. `ElementContext` is now built from a normalised attribute
list — a tag's attributes and a `@Host` props bag arrive in the same shape — and `attr`, `truth`,
`number` and `has` all read it, so there is one answer per question instead of one per source.
`stringAttr`, `trueAttr` and `numberAttr` were rewritten over the same list. That is the third time
this family has been fixed by collapsing copies of one reader, and the first two both left copies
behind.

All three spellings of the callback are read — `() => ({ … })`, `() => { return { … } }` and the
`{ role }` shorthand — and a spread inside the bag takes the same order guard a spread on a tag
takes. A tag chosen per props (`@Host((p) => p.as ?? "div", …)`) leaves the element unknowable, and
the rules that turn on the tag stay quiet while the ones about the attribute name do not.

Measured over the seven real projects here: no new findings, and `apps/docs` runs in 1.38 s against
1.36 s before.
