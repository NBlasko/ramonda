---
"@ramonda/check": patch
---

`row-reads-a-plain-field` no longer offers an ignore for a value "stale on purpose": a row shows it until
something unrelated rebuilds that row. A value the row should show is `@state`, or a field of the
item. An ignore is for a fault being fixed, never the answer to a design.
