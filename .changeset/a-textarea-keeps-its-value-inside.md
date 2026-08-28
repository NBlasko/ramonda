---
"@ramonda/core": patch
---

A served `<textarea>` shows its value before any script runs

HTML has no `value` content attribute on a textarea — the value is the element's TEXT — so
`<textarea value="hello">` was serialized as markup a browser ignores. The reader was shown an empty
field, which filled itself in when the bundle arrived.

The value is now written where HTML keeps it, as the element's child, on both sides. Nothing changes
in how it is used: `<textarea value={x} />` is still the way to drive one, and the property beside
the child is still what makes it controlled once somebody has typed. A textarea written with its
text inside keeps that text, and wins if both are given.

Nothing is written on a textarea's `value` attribute any more, since nothing ever read it.
