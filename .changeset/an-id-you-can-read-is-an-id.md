---
"@ramonda/check": minor
---

An id written out on a spreading element is an id

The project family — `fragment-link-to-nowhere`, `reference-to-an-id-that-is-not-there`,
`control-with-no-label`, `named-only-by-a-placeholder` — reports an ABSENCE: "nothing in this
project carries this id". The table it reads used to skip any element that spread anything at all,
**including an `id` spelled out on the very same tag**. An id missing from that table is a report
against correct markup, and this is the family where that is worst.

Measured on a plant: `<h2 {...rest} id="pricing">` with `<a href="#pricing">` beside it, and the
link was reported as going nowhere. So was `<label htmlFor="email">` whose
`<input {...rest} id="email">` was one line below it. Three of four references reported, every one
pointing at an id written a line above.

Both orders are now recorded, and that is the OPPOSITE asymmetry to the one the element rules take.
There, widening what is reported can only add false reports, so an attribute a spread could reach
over has to be given up. Here, widening the set of known ids can only PREVENT a report — which is
the same sentence that already keeps a literal `id` written on a component tag.

The half of the old stance that was right is unchanged, and pinned: a spreading element is still
never asked about its own REFERENCES, is still not judged for its own NAME, and an unreadable `id`
on one still does not silence the family.

Everything else this family was walked through came back clean: an id and a reference each one hop
from where the rule looks both resolve, and a `<label>` on a base class answers for a control in a
subclass.
