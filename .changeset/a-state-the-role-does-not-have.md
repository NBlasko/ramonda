---
"@ramonda/check": minor
---

New rule: `aria-state-the-role-does-not-have`

`<div role="button" aria-checked={on}>` is the shape. ARIA defines every non-global state as
belonging to particular roles and exposes it only there — `aria-checked` belongs to `checkbox`,
`radio`, `switch` and their kin, and a `button` is none of them. The attribute lands in the DOM,
updates as the state changes, and is announced by nobody.

The author is usually one word from correct, which is what makes it worth reporting: they built a
toggle, reached for `role="button"` because that is what it looks like, and wired up the state that
would have worked on `role="switch"`.

**This is the other half of `aria-state-with-no-role`.** That one asks about an element with NO role
and is certain because a `<div>` has none; this one asks about a role that is WRITTEN and is certain
because the role is right there in the source. Between them they need no table of implicit roles for
HTML at all — which is the reason both could ship.

## The data is attribute-first, and that is the safety argument

The specification documents this twice: each role lists the states it supports, and each state lists
the roles it is used in and inherits into. Reading it **role-first** means getting inheritance right
for every role in ARIA — `checkbox` from `input` from `widget` — and a superclass property missed
anywhere is a report against correct markup. Reading it **attribute-first**, the inheritance is
already flattened into one short list per attribute, each checkable by eye.

The fixture proves it where it matters: `role="treeitem"` takes `aria-checked`, `aria-level` and
`aria-selected` from three different places in the role hierarchy, and `columnheader` takes
`aria-sort` and `aria-colindex` from two. All five are silent.

**Partial on purpose.** Only attributes whose role set is small, famous and stable are carried;
`aria-orientation`, `aria-readonly`, `aria-required` and `aria-activedescendant` are not, because
their sets are long and their inheritance is fiddly. And every doubt inside a list is resolved by
INCLUDING the role: an extra one costs a missed report, a missing one costs a false report, and
those are not the same price.

Silent on an unknown role (`unknown-role`'s report), on a role it cannot read, on a fallback chain,
on global attributes, on an attribute not in the table, and on a spread that may replace either
half.

Measured over all nine real projects here: no findings.
