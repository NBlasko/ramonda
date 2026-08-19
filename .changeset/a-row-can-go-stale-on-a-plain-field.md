---
"@ramonda/core": patch
---

The guarantee about list rows is documented for what it covers, and the one boundary is documented next to
it. No behaviour changed.

The lists page said "what you never get is a stale row", without qualification — and you can, in one shape
that core's own test already asserts. `ListCallbackIdentity.test.tsx` reads the same non-`@state` field
twice in one component, once in the markup and once in a stable row callback, and the two answers differ:
`render()` runs whole and re-reads it, a reused row does not run at all. The test called that "the
documented behaviour" while nothing documented it.

So the promise is stated for what it is — every signal a row reads while it is built is recorded against
that row, and a write marks exactly the rows that read it — and the boundary is stated with the reason it
looks like it works until the callback becomes a method. The fix is the one `@state` already gives: mark the
field, or leave the callback inline, which rebuilds every row and so reads it again.
