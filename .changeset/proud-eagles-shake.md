---
"@ramonda/core": minor
---

RMD030 — state written during `[INSPECT]()`

`[INSPECT]()` describes an instance to the devtools panel. The panel calls it on every commit while
it is open on the components tab, so writing `@state` from inside it closes a circle: the write
schedules a render, the render commits, the commit pings the panel, and the panel asks again.

Two things go wrong, and the second is the worse one. The app does more work to reach the same
screen — and the values on screen stop being the values the app had, handed to the one reader least
able to doubt them, at exactly the moment they are trying to work out what is wrong.

Nothing caught it before: RMD009 watches for a component that will not stop rendering, and this only
turns while somebody is looking. Measured, five scans moved a counter five times and reported
nothing.

The third of a family — RMD001 during `render()`, RMD018 during a `@compute` — and built the same
way, so a describe that throws still clears the phase rather than blaming the next write anywhere in
the app.

Read fields, derive values, return. To cache something, use a plain field rather than `@state`,
which is what `Form` and `Mutation` already do.
