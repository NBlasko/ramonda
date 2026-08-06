---
"@ramonda/check": patch
---

The analyzer is now proved against the JSX runtime real projects use

Its fixtures were all on the CLASSIC runtime — `"jsx": "react"` with `"jsxFactory": "h"`, a factory
the framework no longer exports (core has `__h`, and an app is configured with
`jsxImportSource: "@ramonda/core"`). So nothing had ever run the analyzer against
`"jsx": "react-jsx"`, which is the configuration every real project has. TypeScript emits the same
JSX AST either way, but "should" is not "does".

One fixture is on the automatic runtime now, and asserts a missing provider is found with the right
PATH — which needs the JSX tree walked, so it is the fact rather than the assumption. The same
fixture also stopped writing its components as `h(...)` calls and writes JSX, like every other one
and like the code it stands for.
