---
"@ramonda/check": minor
---

New rule: `aria-hidden-around-something-focusable`

`aria-hidden` takes a subtree out of the accessibility tree. It does **not** take it out of the tab
order — nothing about it touches focus — so a `<button>` inside stays tabbable while ceasing to
exist for the software that would announce it.

What that does to a reader is worse than either half alone. They press Tab, focus moves, and their
screen reader says **nothing at all**: there is no node left for it to describe. Focus is somewhere,
the page has changed under them, and they have no way to find out where they are or what pressing
Enter would do. It is the one accessibility fault that leaves somebody genuinely stranded rather
than merely underserved.

The commonest way to write it is a modal: the dialog opens, the page behind it is hidden from
assistive technology with one attribute, and every control back there is still in the tab order — so
the first Tab takes the reader out of the dialog and into a void.

This is the sibling of `aria-hidden-on-focusable`, which asks whether the element CARRYING the
attribute is focusable. This one asks whether anything inside it is. Together they are the whole of
the fault; separately each is a sentence a reader can act on, which is why they are two reports
rather than one with a flag — and the fixture pins that they never report the same line.

Both fixes are silent, which matters because reporting one would be reporting the fix: `inert`,
which the platform added for exactly this and which removes the subtree from the tab order and the
accessibility tree together, and `tabIndex={-1}` on the control inside. So are an `<a>` with no
`href`, an `<input type="hidden">`, an unreadable `aria-hidden`, and a subtree holding a component
or an expression — `found` is the only answer that speaks, and guessing at what a component renders
is how a rule reports a page that is correct.
