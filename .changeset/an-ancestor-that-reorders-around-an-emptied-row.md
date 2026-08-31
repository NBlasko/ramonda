---
"@ramonda/core": patch
---

The derived node order, pinned one region deeper — through a list

A region's node set is flattened out of `entries` rather than remembered, so an ancestor walking it
sees what a descendant that re-rendered on its own really left in the document. That was already
pinned for a component nested directly in a component.

It is now pinned one level deeper, where the walk has to pass through a `ListRegion` to reach the
component whose contents changed, and where the ancestor REORDERS rather than appends — a reorder
places every node against a reference taken from the set it just derived, so a single stale entry
misplaces its neighbours and not only the new nodes. The row is emptied first, because a row that
contributes no node at all is where a remembered set and a derived one differ most.

Both tests fail when the flattened order is cached instead of derived.
