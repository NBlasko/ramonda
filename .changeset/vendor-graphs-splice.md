---
"@ramonda/check": minor
---

A package publishes its own graph, and an app splices it in.

An installed package is a `.d.ts` and nothing else, and this reads source — so its components, its
hooks and the contexts they need vanished at the package boundary, silently. It is measurable in
this repository today: `apps/playground-core` has no `paths` entry for `@ramonda/form`, so
`this.use(Form<typeof schema>)` reaches `dist/index.d.ts` and the whole package drops out of the
graph.

A package closes it by emitting its graph in its own build and saying where it is:

```json
{ "name": "@acme/ui", "ramonda": { "graph": "./dist/graph.json" } }
```

```bash
ramonda-check tsconfig.json --graph dist/graph.json
```

A package has no root, so its graph comes out with `"scope": "library"`: nothing in it can be judged,
because "unreachable" and "no provider above" are questions only whoever mounts it can answer. What
it carries is a **fragment** — its surface marked `"exported": true`, and its internals as well.
That is the difference from a summary. A summary would say *DataGrid requires Query* and an app
would have to trust it; a fragment is spliced in and walked, so the report names the real path
through the package: `App → Bare → DataGrid → PagedBody`, where `PagedBody` is a class the app
cannot import and has never heard of.

**A stale fragment is refused rather than trusted**, which is the failure this design calls worse
than no map. The fragment fingerprints the declaration file a consumer can actually see — the source
hash is no use to somebody who has `dist` and nothing else — so a package rebuilt without
regenerating its graph is reported and left out, and no verdict is invented from it. A fragment also
carries the package's version, because two versions of one package can be installed at once: the
node ids collide while the graphs differ.

Nothing in this repository publishes a fragment yet, so no app's graph changes.
