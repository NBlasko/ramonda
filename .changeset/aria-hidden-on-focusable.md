---
"@ramonda/check": minor
---

A new rule: `aria-hidden-on-focusable`.

`aria-hidden` removes an element from the accessibility tree. It does **not** remove it from the tab
order, and those are two different lists — so `<button aria-hidden="true">` is still tabbed to,
still focused, and at the moment it takes focus there is nothing to announce. The keyboard lands
somewhere the page insists is not there.

Reported when `aria-hidden="true"` is written on an element that is still focusable: a `<button>`,
`<select>`, `<textarea>`, `<summary>`, `<iframe>`, an `<input>` that is not `type="hidden"`, an
`<a>` that has an `href`, or anything at all carrying a `tabIndex` of zero or more.

It stays quiet on the shape that is correct — `aria-hidden="true"` beside `tabIndex={-1}`, which is
the documented fix — and on any value it cannot read as a literal.
