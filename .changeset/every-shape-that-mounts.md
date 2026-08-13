---
"@ramonda/check": minor
"@ramonda/core": patch
"@ramonda/testing-library": patch
---

Two more ways a component is mounted, and the documentation site is finally visible.

**A function that mounts through the factory and writes no tag at all** is a helper like any other.
It was recognised by looking for JSX tags, so a function that walks a content tree and calls `__h`
for every node was not one — its body was never walked, and everything it mounts was unreachable
while it sat in plain sight.

**A helper handed OVER rather than called** — `tree.map(toVNode)` — is reached too. Whoever it is
given to will run it, so what it mounts is reachable from there.

Measured on this repository's documentation site, which renders its entire content tree that way:
the walk reached **10 of 153 nodes** when this work started, 90 after the factory and the looped
route table, and **142 of 157** now. The only thing of its own it does not reach is the SSR entry,
which nothing calls because the server calls it.

Four more sites carry an escape hatch, and they are all one shape — a function that mounts whatever
it is handed. Three are `@ramonda/core`'s JSX runtime, which is that shape by definition, and one is
`@ramonda/testing-library`'s wrapper. Two more name an element from a parsed content tree.
