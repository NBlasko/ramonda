---
"@ramonda/core": patch
---

A check that a workflow does not bypass turbo — the gap the docs deploy fell through.

`pnpm check` and CI both go through turbo, so both were green while `deploy-docs.yml` ran
`pnpm --filter @ramonda/docs build` directly and skipped the `content` task that `build` declares in
`dependsOn`. The gap was never in *what* is built; it was in *how a workflow asks for it*, and nothing
looked at that.

`scripts/check-workflows.mjs` reads `turbo.json` for the tasks that have dependencies, scans the
workflows, and refuses to see one of those invoked as a package script. Narrow on purpose: only a task
with a `dependsOn` can silently lose a step this way.

It runs in `pnpm check` and in CI, its self-test first — and the self-test earned its place immediately.
The first version anchored its patterns to the start of the line, which in YAML sits after `run:`, so it
matched nothing and pronounced the still-broken `deploy-docs.yml` clean. The self-test now checks both
directions: the offending line is caught, the corrected one is not.
