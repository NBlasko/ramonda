---
"@ramonda/core": patch
---

The teardown of a component that owns nothing where it lives and something where it does not

A component with no node of its own is already known to be reached through the record — the record is
the only thing that knows it is there. This pins the combination that makes the record's job visible:
the component owns NOTHING in its parent and owns a whole block of nodes in a different element,
through a `Portal`.

Nothing in its parent's DOM says either of those things. A teardown that ever decided by asking "does
this region hold any nodes?" would skip it: the hook would never be disposed, and the block would be
left standing in a target that is SHARED, where nobody owns it and the next region to write there
anchors against its leftovers. So the test asserts the TARGET is left empty, anchors included.

It fails when an empty region is skipped as having nothing to tear down, and when a disposed block
leaves its anchors behind.
