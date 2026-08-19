---
"@ramonda/core": minor
---

`htmlFor` now writes the `for` attribute. It used to write nothing.

`concepts/jsx` states the pair as one rule — "`class` and `for` are keywords in JavaScript, so JSX
borrows the DOM property names instead: `className` and `htmlFor`" — and only half of it was
implemented. An HTML attribute is written through `setAttribute`, which lowercases the name, and
`className` was special-cased into `class` while its twin was not.

Measured, not inferred: `<label htmlFor="a">` rendered `htmlfor="a"`, and `label.htmlFor` read `""`.
The label was associated with nothing — no error, no warning, in markup that typechecks and looks
correct. Both the DOM and the server path go through the same writer, so both were affected.

`<label for="a">` always worked and still does; the read-back path normalizes both to the spelling
the JSX uses, so a diff compares like with like. Removal goes through `for` as well — removing it
under the JSX's name would have been the same no-op `className` documents beside its own.

Found while writing `control-with-no-label`, which had been built around an attribute that did
nothing.
