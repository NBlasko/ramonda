---
"@ramonda/core": patch
---

Two shapes a component's variable node count can be asked in, pinned by tests

A `ComponentRegion` may own two nodes, then one, then none, where a host element was always exactly
one node that was always there. A region owning nothing has no neighbour of its own to read, so the
engine answers from the record — and `nextNodeAfter` has to tell three answers apart: a node,
"nothing follows it", and "it is not in this record".

The first shape was probed and found correct in every ordering tried: driven from the parent and from
the component's own state, in both tick orders, with an empty region in front of a full one and with
an empty region last, each time while the siblings rotated. No fault, and the file says so — it exists
to keep an answer that is currently right from drifting.

The second was a hole. Folding "not in this record" into "nothing follows it" passed all 1416 tests in
the package. The existing portal tests each cover one half: an empty component filling in, but into a
bare target with no record of its own; and a target that keeps a record, but with a component that is
never empty. Neither can reach the record branch with a region that is genuinely absent from it. The
new test is the intersection, and it fails when the two answers are folded together.
