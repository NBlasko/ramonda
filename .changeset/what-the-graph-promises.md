---
"@ramonda/check": patch
---

The exported graph is asked what it promises about itself

`closeOverHooks` changed what every consumer of the walk reads and deleted two hand-rolled closures
that had been patching the same hole locally, so the question was whether the graph still says what
it used to. Measured by swapping in `analyze.ts` and `cli.ts` from the commit before the change and
re-exporting: the graph for `apps/docs` — 350 nodes, 895 edges, 19 hooks, 14 `uses` edges — and for
`apps/playground-core` — 80 nodes, 125 edges, 22 hooks, 20 `uses` edges — came out **byte-identical**,
`sha256 04cc9815…` and `sha256 3e4c48d7…`.

Nothing was broken. What was missing is anything that would have said so: `analyze.test.ts` has 19
assertions about the graph across 113 tests, covering node kinds, `renders` edges, `via`, slot
bindings and lazy holes, and **not one of them mentions a `uses` edge** — the edge the change was
about.

Four properties now hold it, over seven fixtures: every edge points at a node the graph declares
(with `unresolved` the one edge allowed to point nowhere), every `uses` edge goes to a node whose kind
is `hook`, a hook reached only through `use()` is exported and is not called dead while one nothing
uses still is, and every fixture is an app rather than a library by accident. Properties rather than
a snapshot, because a node count churns whenever a fixture gains a line and teaches nobody anything.

A fifth was written and then removed rather than kept: that no two nodes share an id. With the dedupe
taken out of the export, nine fixtures produce zero duplicates between them — so the assertion could
not fail. The dedupe is defensive for a shape none of them reach, and its own comment names it.

One dead name goes too, the last live one item 82 named: `core-import.ts` explained the
namespace-access mechanism with `@core.Host`, a decorator the framework no longer has. The mechanism
is the same for `@core.StableProps`, which it has — and the measurement that produced the comment is
kept, marked as having been taken on the decorator since removed.

The other code change is a deletion: a comment left behind in `buildGraph`, which turns out never to
read `reached` at all — so the closure that used to sit there was mutating shared state its own
function had no use for.
