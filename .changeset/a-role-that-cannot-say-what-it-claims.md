---
"@ramonda/check": minor
---

`role-missing-required-aria` — a role written without the states and properties it cannot work
without.

The ARIA rules so far all read one direction: is this name in the vocabulary, is this value in the
list. This reads the other. Every role in the fixture is real, every attribute present is spelled
right, and the markup is still broken — because some roles mean nothing on their own.

A `div` has no checked-ness, no level and no value. So `role="checkbox"` with no `aria-checked`
announces a checkbox in a state nothing can report, which is worse than the plain `div` would have
been: at least a `div` reads as what it is. `role="heading"` with no `aria-level` has no place in
the outline; `role="slider"` with no `aria-valuenow` is a slider at no value.

`ROLE_REQUIRES` is the "Required States and Properties" line from **WAI-ARIA 1.2**, and it is the
first table in this file that has to lean **short** rather than long. The others are vocabularies,
read to report a name that is NOT in them — a short list there reports correct markup. This one is
read the opposite way, so an entry that should not be here reports correct markup directly. Left
out on purpose: every conditional requirement (`separator` needs `aria-valuenow` only when
focusable, and nothing static can say whether it is) and every requirement that moved between ARIA
1.1 and 1.2, `option` and `spinbutton` among them. A requirement people disagree about is not one
to fail a build over.

Only an **explicit** role is judged. A native element's role is the host language's and the host
language supplies what it needs — judging those would report every correct `<h2>` there is — and
`STATE_FROM_THE_ELEMENT` covers the case from the other side, where `<input type="checkbox"
role="checkbox">` carries its state natively. Nor is a fallback chain judged: `role="switch
checkbox"` is a list of alternatives, not one claim.

The attribute counts as present when it is written at all, expression or not. Whether
`aria-checked={checked}` holds something the spec permits is `aria-value`'s question, asked on the
same element.

Zero reports across every app and package here. Both halves proved on a real component: with
`role="combobox"` planted beside the docs' existing `aria-expanded` there is no report, and with
`role="checkbox"` there is one.
