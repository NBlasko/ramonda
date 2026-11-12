---
"create-ramonda": patch
---

A server-rendered app's production build compiles its JSX, as its dev server does: `scripts/build.mjs` holds
`plugins: [ramonda()]`. With style blocks, `ramondaCss()` comes after it.
