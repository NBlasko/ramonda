---
"@ramonda/check": minor
---

A component in another chunk is an edge like any other.

`<AsyncLoad lazy={…} namedExport="Page" />` is the largest edge kind an app has and it is not a
tag: the documentation site in this repository reaches 75 of its 76 lazily loaded components
through one attribute, so a walk without it judged a fraction of what the app mounts. Those pages
are now walked, which means a consumer with no provider above it inside a lazily loaded page is
reported like any other.

Nothing is guessed. The module is a string literal — exactly what a bundler needs to split a chunk,
so a loader this cannot read is one no bundler could split either — and `namedExport` is a literal
saying which class to take. Three shapes are read, all of them measured in this repository: the
loader written in the JSX, one hop to a static field or module constant (which is where `RMD020`
pushes it, since a fresh arrow in the JSX is a new prop on every render), and a literal registry
indexed by a runtime key, which contributes the union of its values. A loader that fails and
retries still reaches its module, because the body is searched rather than read as one expression —
`may reach`, which is the semantics the whole walk is on.

A specifier built at runtime is kept as an `unresolved` edge with its reason rather than left out.

The edge is attributed to the component that writes the tag, not to `AsyncLoad`. `AsyncLoad` is one
shared class and neither provides nor consumes a context, so nothing sits between the two that a
walk would step over — while hanging the targets off it would put every lazily loaded component in
an app on one node and make each reachable from every other. `RouteOutlet` is the opposite case and
keeps its views: it publishes the matched params, so its views have to be below it.

Measured on the documentation site: 140 edges rather than 64, 76 of them through a loader, and the
run is unchanged at ~2.05 s.
