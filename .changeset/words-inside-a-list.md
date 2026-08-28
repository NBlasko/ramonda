---
"@ramonda/check": patch
---

`parent-with-a-foreign-child` counts text, not only tags

`<ul>Items:<li>one</li></ul>` is the same fault with no tag in it. The content model of these
containers takes ELEMENTS, so words written straight inside are as foreign as a `<div>` — and in a
`<table>` the parser moves them out exactly as it moves a foreign element, so the tree the browser
builds is not the tree in the source.

**The whitespace between children is not that**, and it is the thing this would have broken first if
written carelessly. Every one of these containers is written across several lines, so the newline
and the indentation are JSX text nodes on every well-formed list in existence. Only text with
something in it once trimmed is content, and the well-formed list is asserted silent beside the
faulty one.
