---
"@ramonda/check": minor
---

Two rules over markup the HTML parser will not keep where it was written.

`tag-needs-its-parent` — a `<tr>` outside a table, an `<option>` outside a select, a `<summary>`
outside a details. The parser moves these, or drops them, or closes the element it was in the
middle of, so the tree the browser builds is not the tree in the source.

`interactive-inside-interactive` — a link inside a link, a button inside a button, a form inside a
form, a label inside a label. Meeting the second the parser closes the first, so the inner one
becomes a SIBLING of the outer and the failure is behavioural rather than visual.

JSX has no content model — it nests whatever you nest — so neither is something the compiler can
see. The framework watches a narrower version at runtime (`RMD010`, for a component's default host
in a parent that will not take it) and only once the markup renders; on a server-rendered page a
bad nesting also surfaces as a hydration MISMATCH, whose advice is about clocks and random numbers.

Both walk through a callback: `<tbody>{rows.map((row) => <tr />)}</tbody>` is how every table is
written, and a version that stopped at the arrow would be silent about tables. Both go quiet when a
component is in the way, because what it renders is decided inside it.

Warnings, and quiet across this repository.
