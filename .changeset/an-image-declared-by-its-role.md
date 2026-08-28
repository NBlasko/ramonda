---
"@ramonda/check": minor
---

`unnamed-image` now covers an image declared by its ROLE

`<svg role="img" />` and `<div role="img" />` are announced as images and have no `alt` to fall back
on — the attribute does not exist on those tags — so `aria-label` is the only way to name one.
Measured on a sweep: both were reported by nothing, while the `<object>` and `<area>` beside them
were reported by this same rule.

It is how an inline icon is written whenever the icon MEANS something rather than decorating, which
is exactly when it needs a name.

Every existing way of naming one still answers, a name this cannot read still counts as somebody
naming it, and an `<svg>` with no role is not declared to be anything — the rule asks what the
source SAYS the element is, and answers nothing where it says nothing.

## Measured and deliberately NOT built: a role outside its required context

The same sweep found `role="option"` outside a `listbox`, `role="tab"` outside a `tablist`, and
`role="listitem"` outside a `list` — the ARIA counterpart of `tag-needs-its-parent`, which reports
the tag version of exactly that fault.

It is not provable here, and the reason is worth writing down rather than rediscovering. The
required context may come from an ancestor's written `role`, from an ancestor TAG's implicit role
(`<ul>` is a `list`), or **from outside the render entirely** — a `<div role="tab">` inside a
`<Tabs>` component whose own markup supplies the `tablist`. The walk stops at that component
boundary, and a render's own root is itself inside whatever mounted it. So "no ancestor provides the
context" is a claim this analyzer cannot make, and a rule that made it would report the ordinary way
a tab strip is built.

It belongs with the full role-to-properties table as work that needs data this cannot yet afford,
where a silence costs a missed report rather than a false one.
