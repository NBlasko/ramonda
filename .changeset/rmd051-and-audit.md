---
"@ramonda/core": minor
---

`RMD051` reports a list row that nothing can tell apart from its siblings.

`list()` identifies a row by what sets it apart, so a row replaced by fresh objects is recognised and updated rather than rebuilt. A row whose every field is either nested (compared, never counted) or a value its siblings share — `{ tags: [...] }`, or rows carrying nothing but flags — cannot be identified by anything, so it is rebuilt on every replacement and whatever its component held goes with it.

It does not fire for a row that is simply new: page 2 of a table is unpaired too, and warning about that would put a report on correct code. The question asked is about the row — could anything ever have identified it — not about whether it was matched.

The fix is a field of the row's own, or `merge(previous, incoming, (row) => row.id)` where the data arrives.
