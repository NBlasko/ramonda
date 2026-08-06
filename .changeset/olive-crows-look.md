---
"@ramonda/check": patch
---

Every fixture is on the JSX runtime real projects use

They were all on the classic one — `"jsx": "react"` with `"jsxFactory": "h"`, naming a factory the
framework does not export (core has `__h`, and both `create-ramonda` templates configure
`jsxImportSource: "@ramonda/core"`). So the analyzer was only ever proved against a configuration
nobody has. TypeScript emits the same JSX AST either way, but "should" is not "does", and one of the
fixtures now asserts a missing provider is found with the right PATH — which needs the JSX tree
walked — under `"jsx": "react-jsx"`.

No behaviour changed. The `h` stub the fixtures declared for themselves is gone with them.
