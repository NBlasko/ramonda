---
"@ramonda/check": patch
---

The graph hands each declaration over once, and says the honest thing about a library

Two faults, both found by DRAWING the graph rather than by reading it.

**A declaration could appear twice.** `@ramonda/router`'s `Link` and `Navigator` were each in the
graph two times, byte for byte identical: a node reaches the list down more than one path, and the
two are different objects, so the identity check that skips spliced nodes did not catch them.
Measured on this repository's documentation app — 168 nodes of which 166 were distinct.

It matters beyond a tidy file. `--diff` compares graphs BY ID, so one of each pair was invisible to
it, and anything reading the graph into a map by id silently kept one and dropped the other. Nodes
are now deduplicated by id AND position, which is what makes it safe: two nodes that genuinely
collide are two different declarations with different positions, so both still survive — that case
is deliberate and the graph reports it.

**`--graph-html` claimed the undecidable about a library.** A library graph has no roots — the
format says so and says why: *"unreachable and no-provider-above cannot be decided without knowing
what mounts it"*. Every node therefore landed at no depth, and the page drew all of them under
"nothing reaches these", asserting exactly what the analyzer refuses to assert. Measured on
`@ramonda/router`: six nodes, zero roots, six false claims.

A library is banded by what an app can NAME instead — exported or internal — and the "only what
nothing reaches" filter is disabled there, with the reason on it.
