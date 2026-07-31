---
"@ramonda/docs": patch
---

Two real races behind the intermittent failures.

**`oxlint` opened a file `tsup` had already deleted.** `tsup` writes `tsup.config.bundled_<hash>.mjs`
beside the config while it builds and removes it afterwards; the lint task runs concurrently, scanned it,
and by the time it opened the file it was gone —
`Failed to open file … with error "No such file or directory"`. It is in the linter's ignore patterns now.
This is the one that was actually failing: caught by running the whole pipeline four times uncached, where
one run in three went red.

**The docs generated their content twice, in parallel.** `check-types` and `build` both called
`npm run content`, and turbo runs those two tasks concurrently — so two processes rewrote
`src/generated/` while `tsc` was reading it. `content` is a turbo task now with
`outputs: ["src/generated/**"]`, and both tasks declare `dependsOn: ["content"]`, so it runs once.

Neither was ever a test being wrong, which is why three separate "it passed on the retry" moments never
led anywhere. Three consecutive uncached runs of `test lint check-types build` pass now.

`apps/docs/README.md` also stopped saying the site is "not built yet" and pointing at a PLAN.md that was
deleted; it describes the pipeline, both coverage self-tests, and how to regenerate the screenshots.
