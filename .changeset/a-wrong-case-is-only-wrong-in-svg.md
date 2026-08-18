---
"@ramonda/check": minor
---

`unknown-aria-attribute` reported correct markup, and now reports a wrong case only inside SVG.

The rule shipped saying that a wrong CASE was its interesting half — that `aria-labelledBy` "reaches
the DOM as an attribute called `aria-labelledby`-but-not-quite, assistive technology never looks at
it, and nothing anywhere says a word".

**Measured through `renderToString` rather than argued about, and it is false for an HTML element.**
Attributes there are written with `setAttribute`, which the HTML specification lowercases, so
`aria-labelledBy` arrives as `aria-labelledby` and works exactly as intended. Reporting it was
reporting correct code — the one kind of mistake this package treats as fatal to its own
usefulness, and it was in the rule's own headline.

It is true inside SVG. Those attributes go through `setAttributeNS(null, name)`, which writes the
name verbatim — the same render, the opposite result — so a case-only difference there really is an
attribute nothing reads. That is where the rule keeps it.

Everything else is unchanged. A plain typo is still reported everywhere, and so is a name wrong in
more than its case: `aria-labeledBy` is not `aria-labelledby` in any namespace.

`ElementContext` gains `inSvg` to tell the two apart, decided **by tag name**, because that is how
the framework decides it — `<circle>` is SVG wherever it is written, and a `<div>` inside a
`<foreignObject>` is HTML. The tag list is a copy of core's, since this package deliberately depends
on nothing but the compiler, and `SvgList.test.ts` pins the two to each other in both directions by
reading core's source. Written as a first guess, that list was twenty-one tags short — every filter
primitive — and wrongly claimed `title`, which the framework renders as HTML.

The fixture holds both spellings of the same name, one in each namespace, so neither half can pass
by finding the other.
