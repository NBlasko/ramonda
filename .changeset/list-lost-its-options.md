---
"@ramonda/check": minor
---

A list's rows are read where they are written.

`list({ each, as })` is gone from core — a list mounts a component through the callback it takes,
and the row's tag is written in the component the list sits in, which is exactly where the row
mounts. The ordinary JSX walk already reads it, so the machinery that read the `as` option is gone
with the option, along with the `as` value of an edge's `via`.

Measured across this repository: no `as` edge survives in any app, and `renders/tag` rises by the
same amount — the documentation site goes from 29 tags and 5 `as` to 33 tags and none.

That path had no fixture, which is how it could go stale unnoticed; the new shape has one.
