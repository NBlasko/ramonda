---
"@ramonda/core": patch
---

A `Portal` block survives a `@destroyed` that clears the target it writes into

`ChildrenRegion.reconcile` unmounts the children a pass dropped and then inserts the new ones in
front of the block's closing anchor. Unmounting runs user code, and a `Portal`'s target is SHARED —
so the `@destroyed` of a child on its way out can take that anchor away with everything else it
tidies. Measured on a child clearing the element it had been writing into: `NotFoundError: The child
can not be found in the parent`, thrown out of the reconcile, with the children this pass produced
never reaching the page and the target left empty.

The render path already had this window and closed it by searching for its anchor again. That is not
available here — these anchors are the block's own structure rather than a neighbour, so once they
are gone there is nothing to find. They are put back instead, BOTH of them, at the end of the target:
leaving a surviving opening anchor where it stands and appending a fresh closing one would stretch
the block across every node in between, including nodes another region in the same target owns.

That is now the complete list. Two places carry an anchor across user code — the component
self-render and this one — and both re-check it; the other three unmount-then-insert windows derive
their reference at the point of use.
