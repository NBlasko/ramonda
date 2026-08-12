---
"@ramonda/check": minor
---

The composition graph, written out with `--graph`.

Every check this package already makes is one reading of the same thing — which components exist,
and which one can mount which. That is now a value on the result (`result.graph`) and a file:

```bash
ramonda-check tsconfig.json --graph .ramonda/graph.json
```

It holds facts and never conclusions: nodes and edges, no issues and no paths, since the graph is
small while the set of paths through it is not. `kind` is what a walk reads — `renders`, `provides`,
`consumes`, `uses` — and `via` is only how it was written: a JSX tag, children of a wrapper,
`list({ as })`, a route table, `bootstrap`. Splitting the two is what lets a new way of naming a
component arrive without touching any reader.

Every edge carries the place it was written, so a rule computed from the graph can name a line
without going back to the source. A component is identified by its declaration —
`<package>/<file>#<Name>` — and an edge that resolved to nothing is kept as `"kind": "unresolved"`
with the reason: `` `Form` is declared in @ramonda/form/dist/index.d.ts, which this run does not
read ``. A blank left off the map is worse than no map, because it is trusted.

It is a format rather than an API, versioned by `schema`. Measured on this repository's apps: 155
nodes and 64 edges for the documentation site, 46 kB, and no difference to the run's ~2 s.
