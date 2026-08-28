---
"@ramonda/check": minor
---

New rule: `table-with-no-headers`

A table is read visually by POSITION: the eye follows a column up to its heading and back down, and
that costs nothing. A screen reader cannot do that. It announces cells one at a time, and the header
association is the only thing that lets it say "Price, £4.50" instead of "£4.50", read out of a grid
the reader can see nothing of.

With no `<th>` anywhere there is no association to make, so every cell is announced bare. Past three
or four columns the table is not merely harder to read — it is unusable, because nothing says which
column any value came from.

It is also the most invisible fault in this package: `<td>` and `<th>` are one letter apart, they
are styled by the same CSS often enough that the table looks identical either way, and nothing at
runtime says a word.

**A LAYOUT table says so and is never reported.** `role="presentation"` and `role="none"` are
exactly how an author declares that a table is not data, and the accessibility tree honours it —
reporting one would be reporting the documented way of writing the thing this rule does not care
about.

**And the silence is deliberately large.** A table whose rows come from `{rows.map(…)}` or from a
component may have its headers in there, and that is how most real tables are built — so
`unreadable` and `found` are one answer. A rule that guessed would report the commonest correct
table there is. A table with no rows at all, or holding only a `<caption>`, is scaffolding rather
than data and is left alone too.
