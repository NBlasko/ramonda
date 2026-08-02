---
"@ramonda/check": patch
---

`ramonda-check-context` no longer loads the TypeScript lib and `@types/*` declarations it never
reads.

It asks the checker exactly two things — `getSymbolAtLocation` and `getAliasedSymbol` — both of
which are binder work over the files it walks. It never asks for a type, so `Array`, `Promise`, the
DOM and every installed `@types` package were megabytes of parsing for nothing.

Measured: this repo's docs app (68 components) went from **2.4s to 1.6s**, and a four-file fixture
from 214 source files to 2 — 610ms to 3ms. The checker runs FIRST in an app's `build`, so that time
was on every build.

The reported result is identical: same components, same contexts, same issues. A project that does
not compile is still `tsc`'s news to break, not this tool's.
