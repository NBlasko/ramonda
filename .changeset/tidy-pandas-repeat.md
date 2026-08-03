---
"@ramonda/core": patch
---

Fix: a child that renders nothing no longer moves its siblings' DOM nodes

`filterVirtualChild` drops `null`, `undefined` and booleans, and none of them leaves a node behind —
so the pool of existing children is shorter than the vnode list by however many holes precede a
child. `applyDiffOnChildren` handed `claimOrMount` the raw vnode index, which counts the holes, so
every sibling after one looked for itself a slot too far along, missed, and claimed a neighbour's
node by shape instead.

It never looked broken. Attributes and text are patched either way, so the page reads correctly
while focus, text selection, scroll position, the value of an uncontrolled input, a CSS transition
in flight and any state attached to that element have all moved to a different node. Measured on a
minimal case: with `{null}` above two `<p>` siblings, a re-render left the first `<p>` holding the
second one's node.

`{cond && <x/>}` is why this mattered as widely as it did — it is how conditionals are usually
written, and it yields `false`, not `null`. All three hole types behaved the same.

The fix counts the position among children that actually become nodes, which is what the region
path in the same file (`plainIndex`) already did.

Found while building `@ramonda/form`: three `<fieldset>` siblings under one conditional child
rotated by one on every re-render, which cost each array row its element and its focus.

New diagnostic **RMD026** covers the part the fix cannot reach. When the child count changes, an
unkeyed child can be handed the node a different same-tag sibling was using, and nothing in the diff
can tell that apart — that ambiguity is what `key` exists to resolve. It reports only where it is
certain: two or more unkeyed children share a tag AND one of them was matched to a node from
another slot. A relocation where the tag is unique is the diff working and stays silent, as does an
optional sibling appended at the end (`<Card />{cond && <Card />}`), which cannot lose anything.
