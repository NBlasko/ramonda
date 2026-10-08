---
"@ramonda/check": patch
---

**`ramonda-check-bundle` says what to do about a decorator left in the output**: add `ramonda()`
from `@ramonda/build` to the Vite config, or spread `ramondaOptions` into an esbuild build. On Vite 8
that is the only fix — no setting of its own transform lowers a decorator.
