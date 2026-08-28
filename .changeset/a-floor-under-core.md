---
"@ramonda/core": patch
---

A coverage floor, so a drop in this package's tests fails the build instead of passing quietly.

**Nothing a consumer installs changes.** The floor lives in the test configuration, and the published
bundle is byte for byte what it was.

`vitest.coverage.mjs` gained a `withFloor(lines)` beside the settings it already exported, and core's
own config asks for 97 — against 97.95 measured the day the range rewrite merged. A floor rather than
a target: set a point under today's number so ordinary work does not fight it, while ~40 untested
lines does. Per package, because one number across the repo would have to be the weakest package's,
and per run, because `test:prod` executes only the production-only branches and asking it for a whole
package's number is asking the wrong question.
