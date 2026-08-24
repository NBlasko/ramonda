---
"@ramonda/check": minor
---

New rule: `aria-state-with-no-role`

ARIA divides its attributes in two. A GLOBAL one — `aria-label`, `aria-hidden`, `aria-describedby`
— is exposed on any element in the accessibility tree. Every other one is defined BY a role and is
exposed only where that role supports it: `aria-expanded` belongs to `button`, `combobox` and a
handful more; `aria-checked` to `checkbox`, `radio`, `switch`, `option`; `aria-selected` to
`option`, `row`, `tab`.

Written on a bare `<div>`, none of them says anything at all. There is no role for the state to be a
state OF, so assistive technology has nothing to announce. `<div aria-expanded={open}>` beside a
custom dropdown is the commonest shape of it — the author wired the value up correctly and it
reaches nobody.

The fault is invisible in every way a fault can be: the markup is valid, the attribute lands in the
DOM and shows in the inspector, the value updates as the state changes, and nothing anywhere
reports it.

**Narrower than the spec, deliberately.** The full question — does this element's role support this
attribute — needs a role for every tag in HTML and a supported-properties list for every role in
ARIA. Both are large, both are easy to get subtly wrong, and being wrong here means reporting
correct markup. So it asks the half that is CERTAIN: a `<div>` or a `<span>` has no implicit role,
and with no `role` written either the element has none, full stop. No table of roles is consulted
because none is needed, and the other half is left to a later rule that can afford the data — where
a silence costs a missed report rather than a false one.

Silent on a `role` it cannot read, on a tag with an implicit role of its own, on a misspelling
(which is `unknown-aria-attribute`'s report and gets one, not two), and on an element that spreads,
since the spread may be carrying the role. Answers for a `@Host` props bag as well as a tag.

`aria.ts` gains the specification's global list and the two tags certain to have no implicit role.
