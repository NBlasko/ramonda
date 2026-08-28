---
"@ramonda/check": minor
---

New rule: `parent-with-a-foreign-child`

`<ul><div>…</div></ul>`, `<select><span>…</span></select>`, `<table><div>…</div></table>`. This is
the **mirror** of `tag-needs-its-parent`, and neither answers the other: that one asks whether a
child is in the right parent, this asks whether a parent holds the right children. A `<div>` is
legal almost everywhere, so nothing about it is wrong until you see where it sits.

**A list is not styling, it is a COUNT.** Assistive technology announces "list, 5 items" and offers
a way to step through them, working that count out from the `<li>` children. A stray element breaks
the run: some readers announce the wrong number, some end the list early and start a second one. A
reader told there are three items where there are seven is worse off than one told nothing, because
it is confidently wrong.

`<table>` and `<select>` are stricter again — the parser MOVES a foreign child out of the element,
so the tree the browser builds is not the tree in the source. Hydration then reports that as
`RMD007`, a server/client mismatch, and sends the reader looking for a clock or a random number that
is not there. That is the same trap `tag-needs-its-parent` documents from the other side.

**Nobody writes this on purpose.** It arrives when a row gets wrapped for layout, or a tooltip is put
around one, and nothing on screen changes because the CSS was on the row all along.

Only a tag written OUT and known to be wrong is reported. A component child or an expression may
render exactly the right tag — `{rows.map(row => <li …/>)}` is how every real list is built — and
both are left alone. The tags a container takes BESIDE its main one are in the table rather than
assumed away: a `<table>` with its caption and colgroup, a `<select>` with an `<optgroup>` and an
`<hr>`, a `<dl>` with the `<div>` wrapper the specification allows in one, a `<picture>` with its
sources.
