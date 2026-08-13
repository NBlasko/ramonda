---
"@ramonda/check": minor
---

A declaration no root reaches is reported.

The first check computed from the graph rather than from the source, and it needed no new pass over
your code — which is the argument for having a graph at all. The walk already visits everything a
root mounts, so what it never arrived at is what nothing mounts.

**Only what it can prove.** An exported one is never reported: an app is entered through what it
publishes, and an SSR entry is called by the server rather than by your program, so `renderOne` and
`prerender` would be false positives. What is reported is a declaration nothing outside its own file
can even name, that no root reaches.

Two things it took to make it silent on correct code, both measured against this repository:

**A hook a reached component uses is not dead**, though a hook mounts nothing. The walk follows what
MOUNTS, and `this.use(Counter)` is never a mount — right for the provider check, wrong for this one.
Without closing over those, the playgrounds reported three hooks as dead with a component using each
of them one line away.

**Another package's internals are its own business.** These apps compile their dependencies from
source, so an app not using one of core's hooks says nothing about core; before the filter, the
playground reported core's `Provider` as dead.

A library is not judged at all: with no root, everything in it is unreachable by definition. Across
the four apps here the rule is silent.
