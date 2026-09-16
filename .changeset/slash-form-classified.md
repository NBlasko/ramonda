---
"@ramonda/css": patch
---

`border-radius` can be narrowed now, along with nine relatives.

Its grammar is `<length-percentage>{1,4} [ / <length-percentage>{1,4} ]?` — four corners, then four
again after a slash, one primitive throughout. The classifier wanted every piece of a sequence
bracketed and the first one is not, so the property a design system constrains right after padding
could not be narrowed at all.

A `/` separates values in CSS and never is one, so skipping it cannot admit a grammar holding two
kinds: `font`, `grid`, `border-image` and `mask` stay unclassified where they belong.

`PRIMITIVE` 195 → 205, nothing lost and nothing reclassified. The elliptical `border-radius:
50% / 20%` and `animation-range-start: entry 50%` are measured and guarded — a classified property is
a narrowed one, which is where refusing correct CSS becomes possible.
