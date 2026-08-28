---
"@ramonda/check": minor
---

New rule: `label-that-names-nothing`, and one walk where there were three

A `<label>` is an association, not styled text, and HTML gives it exactly two ways to make one:
`htmlFor` naming a control's id, or a control written inside it. With neither, the element renders,
looks completely right, and does nothing.

Two things are lost. The control it was meant for has no accessible name — which is
`control-with-no-label`'s report at the other end of the same missing pair — and **clicking the text
no longer focuses the field**, which is the affordance everybody uses without thinking about it, and
which is hardest on the people with the least room to absorb it: a large click target is the
difference between a usable form and an unusable one for somebody with a tremor.

It is worth having separately from the control's end because the two ends are written in different
files by different people. A form component owns the control; a design system owns the label.

Silent on an `htmlFor` written at all — whether it points at a real id is
`reference-to-an-id-that-is-not-there`'s question, and two reports on one line is how a reader
learns to skim past both — on a control this cannot SEE (`<label>Name<TextField /></label>` is the
ordinary way a form is written), on anything in an expression, and on an element that spreads.

**And one walk where there were three.** `click-with-no-keyboard-path`, `media-with-no-captions` and
now this one all ask "is the thing I am looking for inside here, and if not, could a component or an
expression be hiding it" — the questions differ and the walk does not. It took a third caller before
anybody noticed the first two were the same shape, which is this package's standing lesson arriving
on time for once. `descendantIn` answers all three, with three outcomes rather than two: `found`,
`unreadable`, `none`. Every caller treats the first two alike, and they are kept apart because they
are different facts.

Verified behaviour-free: no finding changed anywhere in the fixtures when the two existing rules
moved onto the shared walk.
