---
"@ramonda/core": patch
---

A list returned straight from `render()` is identified by the component that built it

A region is identified by its owner — the component plus the position — so a list a component built
for itself can never be matched against one handed to it through a prop. `<ul>{list({…})}</ul>` gets
that from the live origin, which is the component's id. `return list({…})` never goes through that
path, so the owner is stamped in `generateRenderOutput` instead — after the block that RESTORES the
previous origin, so the id it read was never the component's, whatever the comment beside it said.

Nothing misbehaved: what it actually read was 0, which is stable and unique per host. But the two
paths produced different identities for the same idea, only one of them was the one described, and it
held only because a build is never entered while another render is in progress.

The stamp now reads the component's own id, so both paths agree. `StraightReturnListOwner.test.tsx`
pins the identity and the behaviour that had to hold either way — a straight-returned list keeps its
rows across a re-render, and two of them side by side never claim each other's.
