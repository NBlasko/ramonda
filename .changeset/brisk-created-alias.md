---
"@ramonda/check": minor
---

A lifecycle decorator imported under another name is read as the lifecycle it is.

`lifecycle-env.ts` looks a decorator's name UP in a table of what each one does — so the local name
was not merely a weaker key than the exported one, it was the wrong key. `import { created as
onCreate }` read as `onCreate` found nothing in that table, so `@onCreate({ env: "server" })`
excused nothing, and `server-env-in-shared-code` reported the `process.env` read inside it as
browser code. **A false report at error severity, on correct code**, and class rules carry no
`ramonda-check-ignore` — so the only way out was restructuring code that was already right.
Measured both ways: reported without the fix, silent with it.

`coreExportName` answers the lookup half of the question `importedFromCore` answers the comparison
half of, and both follow a re-export.

**A known limit, now pinned by a test rather than left to be discovered.** `hasDecorator` — which
fourteen call sites across nine rules read `@state`, `@compute`, `@persist`, `@created`,
`@destroyed` and `@memoized` through — still matches the name written on the member and asks nothing
about where it came from. So an aliased `@state` makes every class rule go quiet, and an app's own
decorator called `state` would be judged as core's. `aliased-decorators.test.ts` measures both
components and records it; closing it means threading resolution through those call sites and the
helpers under them, which is a decision rather than a repair.
