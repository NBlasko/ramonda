---
"@ramonda/core": patch
---

Fix: a child that renders nothing no longer moves its siblings' DOM nodes

`filterVirtualChild` drops `null`, `undefined` and booleans, and none of them leaves a node behind.
A node's **position** among its siblings therefore moves whenever a conditional appears or
disappears — while the piece of JSX that produced it has not moved at all. Matching unkeyed children
by position then hands a child the node its neighbour was using.

It never looked broken. Attributes and text are patched either way, so the page reads correctly
while focus, text selection, scroll position, the value of an uncontrolled input, a CSS transition
in flight and any state attached to that element have all moved to a different node. Measured: with
`{cond && <p/>}` above two `<p>` siblings, a re-render swapped their DOM nodes; with the conditional
_between_ them, the second `<p>` lost its node on every toggle and got a fresh one back.

`{cond && <x/>}` is why this mattered as widely as it did — it is how conditionals are usually
written, and it yields `false`, not `null`. All three hole types behaved the same.

Each node now records the JSX child slot it was built for, holes counted, and an unkeyed child
claims the node carrying **its own slot** rather than whatever sits at its position. Position is
still tried first and is still right on every render where no conditional changed, so the common
path costs one extra property read. Where a slot has no node, the child mounts a fresh one instead
of taking a same-shape neighbour's.

It also removes a scan that predates all of this. When a child had no node to claim, the shape
search restarted at the front of the pool every time, re-walking entries already claimed by earlier
children — which can never match. Growing an unkeyed list from 2900 to 3000 rows visited **295,050**
pool entries to find nothing; it now visits 3,099. The search starts at the first unclaimed entry
instead, a cursor that only moves forward.

Two supporting changes:

- An empty mapped list and an invalid child object used to be dropped from the children array
  outright, which renumbered every sibling after them. They now hold their place: `h` produces one
  children entry per piece of JSX, always.
- A node adopted from server-rendered markup carries no slot yet, so the first diff after hydration
  matches positionally exactly as before, stamping as it goes.

Found while building `@ramonda/form`: three `<fieldset>` siblings under one conditional child
rotated by one on every re-render, which cost each array row its element and its focus.

**RMD026 is removed.** It was added alongside the first, partial fix to report the ambiguity that
remained — an unkeyed child handed a same-shape sibling's node. The slot resolves that ambiguity
rather than describing it, so there is nothing left to report and no keys to add by hand.
