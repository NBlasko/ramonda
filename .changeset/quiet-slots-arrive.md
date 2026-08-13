---
"@ramonda/check": minor
---

A component handed over as a prop is followed to where it mounts.

Two halves that meet at the walk. A component declares which prop paths take a component, read from
its own props type as syntax — and a **path**, not a name, so a slot at depth five is the same
mechanism as one at depth one with a longer string: `view`, `spec.columns[].cell`. A call site
records what it hands over, walked to any depth through object literals, arrays, a ternary (both
arms, because the question is what may reach) and one hop through a module constant, which is where
`RMD020` pushes anything built the same way on every render. And a tag naming a prop —
`<this.props.view />`, or `const View = this.props.view` — is an edge that names the prop it waits
on rather than a missing one.

**A binding lives on the edge, not on the component.** `<Slot view={Reader} />` in one place and
`<Slot view={Writer} />` in another are two arrangements; kept on `Slot` each would be reachable
from the other, and a provider above one would appear to cover the other. The walk carries them
with the path, so the same component filled into the same slot is judged separately on each path —
which is the fixture: one `Slot` mounted twice with one `Reader`, under a provider and not, and
exactly one report.

Slots are read as syntax, and what syntax cannot answer is left alone rather than approximated: a
mapped type, and a function that returns a component. A prop typed as a rendered NODE is not a slot
either, though a node carries a component class inside it — measured, a walk that hunted for the
marker anywhere reported eight slots in `@ramonda/core` that are not slots.

A JSX tag written as a member expression is seen now — `<this.props.view />`, `<screens.reader />`.
Those were invisible rather than holes, because a tag was taken for a component only when it began
with a capital.

Nothing in this repository passes a component through a prop at any depth, so no app's graph
changes: this is for the packages other people write.
