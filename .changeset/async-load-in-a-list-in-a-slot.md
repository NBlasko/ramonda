---
"@ramonda/core": patch
---

Test only: `AsyncLoad` inside a list inside a slot

Three mechanisms one inside another, each tested alone and never together. A `list()` mints identity
and reuses rows across a change; a slot is written in one component and rendered in another;
`AsyncLoad` holds a promise in flight. Nested, the question is whether a load already running
survives what the list does to its row — dropped, reordered, or failing beside a sibling.

Four cases, and no behaviour changed. The reorder case asserts how many times each module was ASKED
for, not what the page shows: every visible outcome is identical under the wrong identity, because
`AsyncLoad` is driven entirely by its props and props follow position. Planted with identity by
position, the page looks right and each module is requested twice.
