---
"@ramonda/lens": minor
---

A path that cannot reach its target throws in development

Stepping through a gap — an optional or nullable hop that is not the last one — returned the root
unchanged and warned. The warning was precise, naming the hop, the whole path and what to do instead.

It was still the wrong shape for the fault. The root coming back unchanged is indistinguishable from a
write that had nothing to do, so what a missed warning leaves behind is an update that quietly does
not happen — and that is exactly what `fatal` already exists for in this package: "the faults where
carrying on would produce a plausible result that is quietly wrong". RML001 is now its third caller,
and its severity is `error`.

**A published build is unchanged.** The check runs there as it always did and still returns the root,
with no message and no throw. That decision has a test behind it and keeps it: the text is bytes
shipped to nobody, and an exception in front of a user buys nothing the author could not have seen
while writing the line.

What changes for an app: a development run that reached this now stops at it. That is the point — the
fault was already there, unread.
