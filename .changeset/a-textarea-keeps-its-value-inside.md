---
"@ramonda/core": minor
---

`<TextArea>`, because a textarea's value is its child

HTML gives a `<textarea>` no `value` attribute — the value is the element's TEXT — so
`<textarea value="hello">` was markup a browser ignores. The reader was shown an EMPTY field, which
filled itself in when the bundle arrived.

`<TextArea value={x}>` writes the value as the element's child, so a served page shows the text
before any script runs, and sets the property afterwards, which is what keeps the field controlled
once somebody has typed in it. Everything else written on it — `className`, `disabled`, `rows`,
every event, every `data-` and `aria-` — passes straight through.

**`<textarea>` is now a type error**, and the message TypeScript prints is the instruction. It has to
be a component rather than a line in the attribute writer: the value must become a CHILD, and the
attribute pass runs before the children, so a text node written there is one the children pass has
never heard of and unmounts as a leftover.
