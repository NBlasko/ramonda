---
"@ramonda/devtools": patch
---

The test timeout is decided once, and it is not a performance budget.

A per-test timeout is a claim about the MACHINE, not about the code. Nothing in this repository
asserts a duration — every case is a DOM fact, a returned value or a recorded call — so the only
thing the number can catch is a test that never finishes. Set close to what tests actually cost, it
catches something else: whatever else the machine was doing.

Measured on 2026-08-14, each file alone and then inside `turbo run test`, which is what CI runs:

```
form/Surgical.test.tsx         3.80 s alone (1.07 s in the tests)   18.6 s under load
form/Bookkeeping.test.tsx      3.60 s alone (0.51 s in the tests)   10.9 s under load
devtools/diagnostics.test.ts   6.01 s alone                         25.7 s under load
```

`@ramonda/form` was on vitest's 5-second default and failed twice. `@ramonda/devtools` had already
set 20 s — against a then-worst case of 894 ms, calling it "deliberately far more than the
contention seen" — and failed anyway at 25.7 s, because the repository grew from 25 concurrent
tasks to 45 and the contention grew with it. **A number chosen as a multiple of today's worst case
expires.**

`vitest.timeout.mjs` now holds one value and one written reason, spread into every package's config
the way `vitest.coverage.mjs` already is. It cannot hide a regression — a test that starts taking a
minute has stopped being one of these, and every run prints its own duration. What it removes is a
flake, and a flake in a gate is worse than a slow gate: it teaches everyone to re-run instead of to
look.

Left alone, and measured rather than assumed: `check`, `build`, `server` and `create-ramonda` have
no vitest config, and their whole suites take 3.84 s, 1.67 s, 0.71 s and 0.64 s. Nothing there is
near the default, so none of them gets a config file for a problem it does not have.

Only `@ramonda/devtools` is released by this, because its own config carried the old number. Every
other change is to a config file that is not published.
