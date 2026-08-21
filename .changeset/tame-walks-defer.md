---
"@ramonda/check": minor
---

A callback handed to something that will call it LATER is no longer part of the render.

`setTimeout(() => { this.n = 1 }, 0)` written in a render was reported as a write during the render,
and so were a `.then`, a `queueMicrotask` and an `addEventListener` — four spellings of the ordinary
way to do each of those, all of them correct code, all reported.

The walk's own prose already said what it should do: "an argument to a call, which is
`list(each, …)`, `.map(…)`, `.filter(…) and their family`". The code accepted an argument to ANY
call. It is an allowlist now, because the deferring calls cannot be enumerated — a function handed
to a name this cannot recognise runs at a time this cannot know, and the silence contract answers
that with nothing. A row builder still runs where the list sits, which is what the framework's own
analyzer says too.

**The `@Host` props callback is part of the render.** `@Host("nav", (self) => ({ className: … }))`
runs every time the component renders and is in no member body, so a clock or a random read there
was reached by nothing. Walked with `insideTheClass` false, exactly as a static is: the callback is
handed the component as a parameter rather than through `this`, so only the reads that depend on
nothing are worth finding.

Every rule that reads a render goes through this walk — `state-written-while-rendering`,
`clock-read-while-rendering`, `dom-writes`, `late-request-read` and the rest — so both changes are
the same change for all of them.

No change to what is reported on any project in this repository.
