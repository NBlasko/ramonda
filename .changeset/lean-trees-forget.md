---
"@ramonda/form": patch
---

The field tree lets go of rows the array no longer has, and `announce` is private

A field node is created once and handed back for the life of the form, deliberately: a fresh one per
access is a fresh `bind.onInput` per access, which RMD020 reports and which really does re-attach the
listener on every render. But "for the life of the form" was also true of a row that had been
**removed** — so a form that once showed ten thousand rows went on holding a node and a handle for every
one of them, each handle carrying two bound closures and a row cache.

Measured on a form grown to 5000 rows of two fields: **15002 nodes and 10001 handles** retained, and
still retained after the array shrank back. Now a shrink drops the nodes and handles for the rows past
the new length, in both trees — 200 rows shrunk to 3 goes from 402 nodes to 8.

Safe because the rows are gone: a caller still holding the node for row 6000 of a three-row array is
holding a row that does not exist, and the next row to appear at that index is a different row that
should get a different node. Asserted from both sides — the rows that survive a removal keep the exact
identity they had, and a row appearing where a removed one sat is not the old node.

The heap figure is deliberately absent: `global.gc` is not exposed in this harness, so a before-and-after
of `heapUsed` measures when the collector happened to run. The object counts are what is measurable, and
they are what the test asserts.

`Form.announce` is `private` now, which is what it always meant — methods are bound whether or not
TypeScript can see them, so it still works as the listener it is registered as, and a hook method that is
not `private` is public API somebody could have called to dispatch a form announcement of their own.
