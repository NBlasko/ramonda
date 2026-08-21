---
"@ramonda/check": minor
---

The `@Host` props callback is part of the render.

`@Host("nav", (self) => ({ className: … }))` runs every time the component renders and is in no
member body, so `entryPoints` did not reach it and a clock or a random read there was found by
nothing. Walked with `insideTheClass` false, exactly as a static is: the callback is handed the
component as a parameter rather than through `this`, so only the reads that depend on nothing are
worth finding.

Every rule that reads a render goes through this walk — `clock-read-while-rendering`, `dom-writes`,
`late-request-read` and the rest — so it is one change for all of them.

No change to what is reported on any project in this repository.
