---
"@ramonda/check": minor
---

`role-takes-no-name` — an `aria-label` written on something the specification forbids naming. This
is the last of the ARIA tables, and it is deliberately a **slice** of the role matrix rather than
the matrix.

An `aria-label` is not a tooltip and not a comment: it is the accessible NAME of a thing in the
accessibility tree, and each role's characteristics say whether it may have one. A `<div>` is
`generic` — the role for an element that carries no meaning — so there is nothing for a name to
name. `<div aria-label="Filters">` does not label a region. It does nothing: the attribute is in the
DOM, visible in the inspector, and a screen reader announces the children exactly as it would have
without it. `role="presentation"` is stronger still and removes the element from the tree entirely.

**Why not the whole matrix.** Which of the ninety-odd roles supports which `aria-*` would be the
most dangerous table this package could carry: it is read to report an attribute that is NOT
supported, so every cell missing from it reports correct markup, and there are thousands of cells.
Naming is the part that is unambiguous, short, and worth having on its own. The rest of the matrix
is not planned.

A written `role` always wins over the tag's own, which is what makes this safe: `<div role="region"
aria-label="Filters">` is correct and common, and a role this cannot read silences the element.
`<section>` is left out of the tag table for the sharpest version of the same point — it maps to
`region` **when it has an accessible name**, so naming it is not merely allowed, it is the
documented way to write one.

An attribute whose case is wrong is not a name. `aria-labelledBy` reaches the DOM as a different
attribute from `aria-labelledby`, so it is `unknown-aria-attribute`'s business — matching it here
would report that the name does nothing, for the wrong reason. Found by running the rule over the
fixtures that already existed, where it also turned up two lines written as "not reported" that
really were faults.

Zero reports across every app and package here. Both directions proved on real code: `aria-label` on
the docs' existing menu **button** reports nothing, and the same attribute on a `<div>` reports.
