---
"@ramonda/check": patch
---

Four shapes the element rules had an opinion about and did not recognise. None is exotic; each was
planted and measured, and each has its opposite in the fixture — the shape that must stay silent is
what says a rule got sharper rather than louder.

**`aria-hidden` written as a boolean.** `aria-hidden`, `aria-hidden={true}` and `aria-hidden="true"`
are one fact spelled three ways, and the framework renders all three the same. Only the string was
read, so `<button aria-hidden>` hid a focusable button and was reported by nothing. A shared
`trueAttr` reads all three, and `aria-hidden="false"` is still not a claim.

**A link whose only content is hidden.** `<a href="/x"><span aria-hidden="true">★</span></a>` is full
in the DOM and a blank row in the list of links a screen reader builds — the icon-only link, which
is the commonest way to write this fault. `empty-heading-or-link` is about the accessibility tree, so
it asks about that tree now: every child hidden by a LITERAL claim, and nothing naming the link. One
readable word beside the icon, or a component child it cannot see into, and it says nothing.

**An index key on a COMPONENT row.** `row-without-a-key` already asks a component for a key, for the
reason that decides both — a component is what HOLDS the state that lands on the wrong row — while
`index-as-key` skipped them, leaving the family disagreeing about the same list and the rule silent
where the key matters most.

**A heading that is not a tag.** `role-missing-required-aria` already asks a `role="heading"` for its
`aria-level`, so `heading-skips-a-level` reading levels off tags alone left the two disagreeing about
the same element. It reads the accessibility tree's answer now: `role="heading"` counts, an
`aria-level` wins over the tag, and a written role wins over the tag entirely — so an
`<h2 role="presentation">` is out of the outline. A heading whose level cannot be read breaks the
chain rather than being stepped over, exactly as one that may not be there does. The report quotes
what is on the line, because calling a `<div role="heading" aria-level={3}>` an `<h3>` would send a
reader looking for a tag that is not there.

Nothing new is reported in this repository's four applications.
