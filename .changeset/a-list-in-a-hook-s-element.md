---
"@ramonda/core": patch
---

A list inside an element in a hook's children updates when only its rows read the change

`this.use(Portal, () => ({ children: <ul>{list(rows, row)}</ul>, target }))` — a list one element
down in the children a hook consumes. A `ChildrenRegion` hands its own host to the lists it
reconciles, so that a row's change refreshes the region: the children came from the hook's props
factory, whose cache is clean when only a row read the signal. The host reached a list placed
directly in the children and not one inside an element, which reported to the owner instead; the
owner re-rendered, the factory cache stayed clean, nothing reconciled the region, and the row kept
its old text. On the client build path and after hydration alike.

The host is now carried down through elements, and reset at a component: a component inside the
portal keeps its own lists reporting to itself. `ListInPortal.test.tsx` (one and two elements down,
a component inside) and `PortalTargetSsr.test.tsx` (an adopted block) cover it; the carry on either
path and the reset at a component, each taken out on its own, fail them.
