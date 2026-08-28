---
"@ramonda/check": patch
---

Findings from the branch's own review

Fresh code is the least-examined code on a branch, and this was a long one.

**Two rules answering "is this focusable" two different ways.** `aria-hidden-on-focusable` asks it
of the element the attribute is ON; `aria-hidden-around-something-focusable` asks it of an element
INSIDE that subtree. The second had written its own walk over the raw JSX attributes, and it
disagreed twice — measured with a plant, both times reporting markup that is correct:
`<input type={HIDDEN}>` where `const HIDDEN = "hidden"`, because a walk that accepts only a string
literal does not follow a name to the value it holds; and `<button {...rest}>`, where `rest` may
carry the `tabIndex={-1}` that takes it out of the tab order. There is one reader now,
`inTheTabOrder`, and it answers three ways rather than two: proved in, proved out, and not
provable here.

`descendantIn`'s matcher can say `"unreadable"` for the same reason, so a caller's uncertainty
travels out with the walk's own instead of being flattened into "none".

**Two exports nothing outside their own file used** — `narrowsTo` and `attributesOf`. An export is
a promise, and this package curates its surface on purpose.

**Three silence assertions pointing at nothing.** `foreign-child`'s list of containers that must
stay quiet named a comment, a closing tag and a blank line, so four of the ten silences it claims
to check were never checked. A negative assertion passes whatever it points at, which is what makes
getting the line right the whole of its value.
