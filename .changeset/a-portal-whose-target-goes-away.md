---
"@ramonda/core": patch
---

A portal whose target goes away takes its content off the page

`this.use(Portal, (s) => ({ children: <Dialog />, target: s.open ? document.body : undefined }))` is
how a modal closes, and closing it left the dialog on the page: a missing target made the portal do
nothing, so its nodes stayed where they were. The block now leaves with the target. Its nodes move
into a fragment off the page and come back when a target returns. The component in it keeps its
state and is not destroyed while it is away. A change to the children made meanwhile is applied when
the target returns, so a component the children gain is created on the page, never off it.

A target that is absent from the start builds nothing until it arrives, as before.
`Portal.test.tsx` covers both.
