---
"create-ramonda": minor
---

The scaffolder requires Node 24, and refuses rather than warns.

`engines` said `>=18`, which was never true: the SPA template pulls Vite 7, whose own floor is
`^20.19 || >=22.12`. So a user on Node 18 got a project that installed and then failed to build, in a way
that reads as Ramonda's fault rather than as a version mismatch.

`engines` is advisory — npm prints a line and `npm create` proceeds — so the number alone cannot be the
mechanism. The check now runs at the top of the CLI, **before anything is written**: it prints what is
needed and what is running, and exits 1. Verified by running the built entry with `process.versions.node`
patched to 22.9.0 — message shown, exit 1, no files created.

Node 24 rather than the toolchain's actual floor, because it is the version this repo builds and tests on
and `0.x` has nobody on old runtimes to keep faith with.

The tests cover the boundary and assert that `engines` and the refusal agree, so the advisory and the
mechanism cannot drift apart.
