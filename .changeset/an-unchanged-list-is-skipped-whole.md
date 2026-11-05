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

Only a node an engine built is skipped, and only by the engine that built it. An array of children is
a list as well, built once and kept in the vnode around it, so a reused row hands back the same array
node while a list inside the array has changed; and a group that replaces a `list()` in the same slot
shares its owner, so it does not take the list's engine — the list's engine is released instead.

A group — an array among the children, `<ul>{this.props.children}</ul>` — is kept whole too when it is
the same object as last pass and holds no `list()` anywhere inside it: such a group is the same
markup. A component row does not stop it — the same vnode carries the same props, and a row that
changes on its own renders itself — so 1000 `<Row />` are not looked at either. Counted in
`RenderCost.test.tsx`: a panel over 1000 rows, re-rendering on its own state, diffs none of them and
walks none of them. A group that does hold one, at any depth
(`[<div>{list(…)}</div>]`), is opened every pass, because something inside it changes on its own.
