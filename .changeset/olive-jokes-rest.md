---
"@ramonda/core": patch
---

Dead documentation pointers removed

Eighteen references in fourteen files pointed at documents that do not exist: `BUGS.md` (the most
common), `TODO.md`, `docs/AsyncLoad.md`, `docs/async-ssr-proposal.md` and `apps/docs/PLAN.md`. Every
comment that carried one already explains itself — the pointer was an extra, not the load-bearing
part — so they are gone rather than replaced.

The README's Documentation section listed three of those files as if they were there. It now points
at [ramonda.pages.dev](https://ramonda.pages.dev), which exists, and at `DIAGNOSTICS.md`, which is in
the package. The paragraph that said the documentation site "is planned in apps/docs/PLAN.md" now
says where it is.
