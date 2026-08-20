---
"@ramonda/core": minor
---

RMD020 reaches inside a row. An inline handler or a rebuilt object on a `.map()`ed row, or in a `list()`
row callback, was silent — the same thing written by hand was reported.

**Why it was silent, which is one cause with two halves.** `h.ts` wraps any array in children position
into the same `IS_LIST`-branded shape a `list()` descriptor has, and the comparison had one branch for
both: compare `each`, stop. That is right for a descriptor, whose builder has not run and whose rows do
not exist yet. A `.map()` region is the opposite — its rows are already built and sitting in `vnodes`, in
both outputs — and they were discarded. So `<li onClick={() => …}>` was reported when written by hand and
silent the moment it came from an array.

**Two fixes, in the two places that have something to compare.**

A region's rows are compared where the render output is walked, which costs no BUILDS: nobody builds
anything that was not built anyway. Each row is checked on its own budget rather than sharing one with its
neighbours, because sharing truncated — measured, a 1000-row `.map()` whose only mistake was on the last
row went unreported.

A `list()` row is built by the engine during the diff, so `listEngine.ts` builds it a second time there —
with the tracker detached, so the throwaway build adds no dependencies — and compares. That is also the
cheap place:

```
100 rows, a stable callback, mount then three more renders
check on:   200 row builds on mount, 200 after the three
check off:  100                      100
```

Twice for a row that is **built**, nothing for one that is reused. A list whose rows are steady pays
nothing after the first render, and `configureDev({ strictRender: false })` turns off the second build
along with everything else.

**One consequence to expect:** a row callback with a side effect performs it twice in development, exactly
as a `render()` already did.

**One report per callback, not per row.** The row index is left out of the path deliberately —
`diagnose` keys a report by owner, path and kind, so an index would turn one mistake into one report per
row. Rows that are wrong in *different* ways still separate themselves, because the tag and the attribute
name are in the path.
