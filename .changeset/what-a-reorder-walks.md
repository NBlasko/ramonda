---
"@ramonda/core": patch
---

A reorder stops searching every element for a portal that is not in it

`reorderChildren` has to know whether an element holds a `Portal`'s block, because a block is
appended into its target and so sits after the element's own children — a fresh child has to go in
BEFORE it or the guest ends up in the middle of the host's own run.

It answered by walking every child. The answer is no for almost every element, and it was reached
after visiting all of them: measured on 500 rows moving one, 1501 sibling steps against 1001 with
the search taken out, and on 60 rows 121 against 181. One whole extra pass over the children, on
every reorder, to find nothing.

`ChildrenRegion.place` marks the targets it uses, so an element that was never one now stops at a
property read. The mark is never taken off: clearing it correctly would need a count of the blocks a
target holds, and the cost of leaving it is that an element which once hosted a block goes on
walking — which is what every element did before, so the worst case is the present.
