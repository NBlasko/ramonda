---
"@ramonda/check": minor
---

A name written and left EMPTY names nothing, in every rule that asks

`aria-label=""`, `aria-labelledby=""` and `title=""` give the accessibility tree no name at all —
the attribute is there and the element is still anonymous. Four rules read them by PRESENCE alone,
so an author who wrote a name and left it blank was treated as having named the thing:
`unnamed-image`, `unnamed-frame`, `empty-heading-or-link` and
`landmarks-that-cannot-be-told-apart`.

**The id table had already worked this out and kept it to itself.** Its own note records the
measurement — `<input aria-labelledby="" />` had no name and was reported by nothing, "because the
attribute that names nothing had answered for the one that would have" — and it fixed its own
reader while four rules beside it went on asking the old way.

That is this package's standing fault, and it was five copies deep: the same three attribute names
written out five times, three of them under the same identifier and two character for character.
There is one list and one reader now, in `naming.ts`.

**`alt` is deliberately not in it.** It names an image and only an image, and it is the one naming
attribute where empty is a STATEMENT rather than an omission: `<img alt="">` is the documented way
to say "decoration, skip me". `unnamed-image` passes it in separately and it is still asked by
presence, so a decorative image stays silent.
