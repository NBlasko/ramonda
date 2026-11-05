---
"@ramonda/testing-library": minor
"@ramonda/core": patch
"@ramonda/query": patch
---

A development diagnostic fails the test it happened in. Diagnostics are printed, not thrown, and a test runner hides a passing test's console, so a test could cause RMD020 on every run and say nothing — found by an agent whose tests passed over three of them, one a real bug. After each test, once its tree is unmounted, a Ramonda diagnostic at `warn` or `error` fails it, naming the code. `allowDiagnostics("RMD003")` lets one test show one on purpose; `@ramonda/testing-library/dont-fail-on-diagnostics` or `RAMONDA_TL_ALLOW_DIAGNOSTICS` turns it off for a run. Each test starts with every diagnostic able to be reported again: a package that says each one once per process adds its reset to `globalThis.__RAMONDA_DIAGNOSTICS_RESET__` in development — core and `@ramonda/query` do — and the harness calls them all, depending on no package but core.

Hydration no longer reports RMD007 for an empty string child. The server has nothing to serialise for `""`, so finding no text node there is the match: `<span>{error ?? ""}</span>` was reported on correct markup.
