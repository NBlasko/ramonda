---
"@ramonda/check": minor
"@ramonda/core": minor
"@ramonda/router": minor
"@ramonda/query": minor
"@ramonda/form": minor
---

Every package ships its graph, and a graph describes what a project ships.

`@ramonda/core`, `@ramonda/router`, `@ramonda/query` and `@ramonda/form` emit their fragment in
their own build and point at it from `package.json`:

```json
{ "ramonda": { "graph": "./dist/graph.json" } }
```

An app that installs them rather than compiling them from source now gets their composition instead
of a hole. Measured on `apps/playground-core`, which has no `paths` entry for `@ramonda/form`: its
two unresolved `this.use(Form<typeof schema>)` edges are gone, and four of the package's own nodes —
`Form`, `Field`, `FormState` and the context the form publishes — are in the app's graph.

**A graph now describes what a project ships, so test files are left out** — `__tests__/`, `test/`,
`tests/`, `*.test.*`, `*.spec.*`, judged relative to the directory holding the tsconfig. This is a
change to what the checks read as well: a class written to be checked is no longer reported. It had
to happen for a fragment to mean anything. Measured: `@ramonda/query` counted 109 components against
a real 12, `@ramonda/form` came out as an APP because its tests mount one, and core's fragment
carried a component from a fixture directory.

Two more things fell out of emitting fragments for real packages:

**A root is a `bootstrap` that names a component.** `@ramonda/testing-library` calls `bootstrap` on
a vnode it is handed — that is its whole job — and a call whose argument nothing can name starts no
tree. Counting it made every package that maps testing-library in its tsconfig come out as an app.

**A library's fragment describes itself.** These packages compile their dependencies from source, so
`@ramonda/router`'s fragment carried `@ramonda/core`'s classes too — the same nodes, under the same
ids, that core's own fragment declares. An app splices one fragment per package and gets each once;
an edge pointing into another package still resolves, because the id is the same on both sides.

Across this repository's four apps the graph is now complete but for two edges, and both are
deliberate demonstrations of a failed load.
