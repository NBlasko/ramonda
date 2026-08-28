---
"@ramonda/check": patch
---

`context-consumed-above-its-provider` orders two halves in one field by the calls, not by the field

Both provider rules turn on one fact — field initialisers run in declaration order, furthest
ancestor first — so the walk is where a gap would be. Walked, and most of it held: a base that
consumes with a subclass that provides is correctly the fault ACROSS FILES, a base that provides
with a subclass that consumes is correctly the arrangement rather than the fault, and neither a
`readonly` modifier nor a `static` field between the two changes anything.

One shape fell through. `pair = { reads: this.use(C), writes: this.use(P) }` is constructed left to
right and is the same fault as two fields in that order, but ordering was by the FIELD's start
position — one node for both halves — so the comparison settled nothing and the rule fell through
to silence. The `this.use` calls carry their own positions now. That is meaningful because one
field is one file; across the heritage chain it is still `rank` that orders, which is the whole
reason `rank` exists.

`one-provider-per-component` needed nothing: a SECOND provider is the fault wherever it sits, so it
was already right about two in one field and about one on a base with another on the subclass.
