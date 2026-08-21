---
"@ramonda/check": patch
---

A node from an installed package appears once in the graph, in a place that does not move with the
process.

Two faults, one line. A kit destructured out of a factory — `const { Router, Link } = createRouter(routes)`
— binds each member to a local symbol, which is how the walk resolves `<Link />`, so the node a
package's fragment brought in was in `components` as well as in the spliced list. `buildGraph` emitted
both: **the same id twice, with two different places.** Measured on this repository's own fixtures —
three duplicated ids in `kit`, two in `kit-ambiguous`.

And the second place was wrong in a way that MOVED. A fragment's `at` is already relative to its own
package, so running it through `pathOf` sent it climbing for a `package.json` — and `ts.sys.fileExists`
resolves a relative path against the process's working directory. So `@acme/kit/src/index.tsx` was
attributed to `@ramonda/check` when the CLI ran from that package, and to `ramonda-monorepo` when it
ran from the repository root. `ramonda-check apps/docs/tsconfig.json` from a repository root is exactly
that shape.

The graph HASH never moved with it — that is taken over source text and absolute file names — so no
published graph's identity changes. What changes is what a reader is shown, which is the whole point of
`at`.

Pinned two ways, and planted: no id is emitted twice across the four vendor fixtures, and the two kinds
of place are asserted apart — a node from this program is placed against the project
(`@ramonda/check/src/…/app.tsx`), a node from an installed package keeps the path that package gave
(`src/index.tsx`), because its id already says whose it is.
