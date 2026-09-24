---
"@ramonda/css": patch
---

The docs now explain a prop that takes a style block.

`CssBlock<Allow>`, what goes in an allow-list, why one prop is one element,
and the two rules the checker runs — all of it existed and none of it was written down for a reader.
The only trace on the site was two lines in the generated rule table.

The page is `/style-blocks/prop`, between composing and the config.

It also fixes the gate that checks every example on the site. `shape()` decides how to wrap a fenced
block — as a module, a class body or a method — and it was reading the VIRTUAL file rather than what
the author wrote. The virtual file's preamble is one long line that the author's first line
continues, so a block that IS a class declaration looked like one that was not: measured,
`class Card extends Component<…>` holding a style block was wrapped in a class BODY and reported
`TS1184: Modifiers cannot appear here` six times, about a wrapper nobody wrote. Any page documenting
a component that takes styles would have hit it.
