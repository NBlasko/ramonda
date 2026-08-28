---
"@ramonda/core": patch
---

`muted` and `indeterminate` reach the element, and an attribute HTML does not have is not written

An attribute is the state an element STARTED with, which for most elements is the whole story. For
these it is not, and the property was missing:

- `<video muted>` went out with `.muted === false`, so the video played with sound — and a browser
  refuses to autoplay one that is not muted, so `<video muted autoplay>` did not play at all.
- `indeterminate={true}` left `.indeterminate` false and put `indeterminate="true"` in the markup.
  There is no such attribute in HTML: a checkbox's third state exists only as a property. A
  server-rendered page therefore cannot carry it — the box arrives unchecked and becomes mixed when
  the page hydrates.

Both now turn off with the model as well, which removing an attribute cannot do once the element is
live. That is the rule `checked` already followed.

Behind them, one rule replaces what would have been a branch per tag: an attribute HTML does not
give an element is not written at all. `value` on a `<textarea>` or a `<select>` is the same case —
each name is real HTML elsewhere and means nothing there. The list lives in `@ramonda/dom-facts`,
where `@ramonda/check` can report the same names where they are typed.
