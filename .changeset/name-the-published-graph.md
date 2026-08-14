---
"@ramonda/core": minor
"@ramonda/router": minor
"@ramonda/query": minor
"@ramonda/form": minor
"@ramonda/check": patch
---

The published graph is `dist/ramonda-graph.json`.

It used to be `dist/graph.json`. Nothing resolves it by name — an app reads the `ramonda.graph`
field of the package's `package.json` — so **a package already built to any other path keeps
working**, and there is nothing to migrate.

The name changed for where the file ends up. It is PUBLISHED: it sits in a stranger's
`node_modules/@ramonda/core/dist/` beside whatever their bundler wrote, and `graph.json` there says
neither whose it is nor what it is for. Same argument as the binaries being `ramonda-check` and
`ramonda-check-bundle` rather than `check` and `check-bundle`. An app writing its own graph needs no
prefix and does not get one: it picks the path, and nobody else ever reads the file.

Collision was never a correctness risk and this does not fix one — a foreign `graph.json` in `dist`
would have been refused out loud rather than believed, because the loader checks `schema`, `scope`,
the package name and the declaration-file hash before anything is spliced. What it removes is the
chance of two tools quietly overwriting each other in the one directory every tool treats as its
own.

Verified end to end rather than assumed: the four packages emit to the new path, `npm pack` carries
`dist/ramonda-graph.json`, and `apps/playground-core` — the one project here that resolves a Ramonda
package through `node_modules` rather than a tsconfig path — still splices `Form`, `Field`,
`FormProvider` and `FormState` out of `@ramonda/form`'s fragment.
