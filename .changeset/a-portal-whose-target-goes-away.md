---
"@ramonda/core": minor
---

A portal whose target goes away takes its content off the page

`this.use(Portal, (s) => ({ children: <Dialog />, target: s.open ? document.body : undefined }))` is
how a modal closes, and closing it left the dialog on the page: a missing target made the portal do
nothing, so its nodes stayed where they were. The block now leaves with the target. Its nodes move
into a fragment off the page, of the document they live in and come back when a target returns. The component in it keeps its
state and is not destroyed while it is away, and a list row that changes in it renders nothing until
the portal opens. A change to the children made meanwhile is applied when
the target returns, so a component the children gain is created on the page, never off it — and so
is one a list row inside gains when its own signal moves while the block is away.

A portal inside the block closes with it: a modal's dropdown, portalled to a layer of its own, leaves
the page with the modal and comes back with it, on a client build and after hydration alike.

A target that is absent from the start builds nothing until it arrives, as before. A block that
comes back takes the place it left in its target, so two portals sharing one keep their order across
a close and an open.
`Portal.test.tsx` covers both.
