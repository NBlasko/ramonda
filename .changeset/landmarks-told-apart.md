---
"@ramonda/check": minor
---

New rule: `landmarks-that-cannot-be-told-apart`

A screen reader offers landmarks as a LIST — it is how somebody moves around a page without
scrolling through it, and for a reader who cannot see the layout it is the closest thing to glancing
at a page. A landmark with no accessible name is announced by its kind alone.

So a page with a primary navigation and a footer navigation offers "navigation, navigation", and the
reader has to enter one to find out which it is, come back out, and try the other. With three —
primary, breadcrumb, footer — it stops being worth using at all, and the feature that exists to make
a page navigable has made it slower than reading straight through.

The fix is one attribute and the page looks identical afterwards, which is the whole reason this is
worth reporting: nothing about the rendered page will ever remind anybody.

**Only when NEITHER is named, which is the sharp line.** Two unnamed landmarks of one kind cannot be
told apart — that is a fact about the list, not a preference. One named and one unnamed CAN be:
"navigation" and "Footer navigation" are two different entries. The convention is to name both, and
this deliberately enforces the ambiguity rather than the convention.

All of them are reported, not all-but-one: every one needs a name before the list can be read, which
is the opposite of `more-than-one-main`, where one is allowed and only the extras are wrong. `main`
is absent from the landmark set for that reason — two of those are that rule's report, and naming
them would not make two mains correct.

**What counts is deliberately not the whole set.** `<nav>` always is a landmark wherever it sits,
and an explicitly written `role` is certain because it is in the source. `<header>`, `<footer>`,
`<section>` and `<aside>` are absent: whether they map to a landmark at all depends on where they
sit in the sectioning tree, and being wrong about that means reporting correct markup. The certain
half now, the rest when the data can be afforded.
