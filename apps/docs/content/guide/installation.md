---
title: Installation
description: Install Ramonda and configure the three build settings it needs.
section: Guide
order: 10
---

# Installation

```
pnpm add @ramonda/core
```

Ramonda has no runtime dependencies. What it does have is three build requirements, and all
three fail in ways that do not point at the config — so they come first.

## 1. `__DEV__` must be defined

Every development-only check in the framework is wrapped in `if (__DEV__)`, so a production
build strips the diagnostics, the messages and the devtools bridge entirely. That only works
if your bundler replaces the identifier.

If it is missing, the app throws a `ReferenceError` at import time, from inside framework code,
with nothing in the stack trace mentioning your build config.

## 2. Decorators must be transpiled

Ramonda uses TC39 stage-3 decorators. Chrome parses them natively, which is the trap: a dev
server can appear to work while a production or server build fails with
`Invalid or unexpected token` on the first `@Host("div")`.

Set a `target` your bundler will down-level, and make sure the transform runs for your source.

## 3. The JSX factory is `h`

Ramonda's `h` is not React's `createElement`. Point the JSX transform at it and inject it, so
individual files do not have to import it.

## A working Vite config

```js
import { defineConfig } from "vite";

export default defineConfig({
  define: {
    __DEV__: JSON.stringify(process.env.NODE_ENV !== "production"),
  },
  esbuild: {
    jsxFactory: "h",
    jsxInject: `import { h } from '@ramonda/core'`,
    target: "es2022",
  },
});
```

## tsconfig

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react",
    "jsxFactory": "h",
    "strict": true
  }
}
```

## Check it works

```demo:Counter
```

If that counts up, all three settings are right.
