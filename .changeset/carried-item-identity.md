---
"@ramonda/core": minor
---

A refetch updates its rows instead of destroying and rebuilding them.

Data from outside — a refetch, a `JSON.parse`, anything round-tripped through the network — hands over fresh objects meaning the same rows, so matching by reference found none of them and every row was destroyed and built again: `@destroyed`, `@created`, and whatever each row's component was holding. Measured on a two-row list where one title changed: both rows recreated and a half-typed draft lost. `key: (item) => item.id` existed for this.

`list()` now aligns the incoming array against the one it is showing and carries each row's identity across, so a row that changed keeps its DOM node, its component instance and its state. Rows equal by content are the anchors; rows between two anchors are paired by how much they still have in common. No field is privileged — an `id` counts for exactly as much as any other, because a framework cannot know which field is an identity.

Two arrays with nothing in common have no anchors and share nothing, so page 2 of a table never inherits page 1's rows. A `{ ...row }` copy is a new row: identity is a non-enumerable symbol, invisible to spread, `JSON.stringify` and every equality check. A frozen row keeps matching by reference.

This changes what a replaced row object costs. It used to reset that row's state; it now carries it, and `key` is no longer needed for re-created objects.
