---
"@ramonda/core": patch
---

An unchanged list is skipped whole, without looking at a row

When a list's array and row callback are the same as last render and nothing its rows read has
changed, the engine hands back the same built node, and the diff now keeps the whole region on that
alone. A re-render for unrelated state over 1000 rows reads none of them; before, it claimed every
row one by one. `WholeListSkip.test.tsx` counts the rows read.

The diff had this skip already, and it never fired: it compared last pass's built node with this
pass's `list()` descriptor, a fresh object on every render. It compares the built node now — which is
safe only because a list inside a row now marks the rows above it when it changes, so "the same node"
includes everything inside the rows (see the changeset for a list inside a row).

Only a node an engine built is skipped. An array of children is a list as well, built once and kept
in the vnode around it, so a reused row hands back the same array node while a list inside the array
has changed.
