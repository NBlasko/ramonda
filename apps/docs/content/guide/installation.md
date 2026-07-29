---
title: Installation
description: Start a new project with create-ramonda, or add Ramonda to one you already have.
section: Start here
order: 10
---

# Installation

## The quickest way: create-ramonda

The scaffolder sets up a runnable project for you, with the build already configured:

```
npm create ramonda@latest my-app
```

It asks a couple of questions — a client-side app or a server-rendered one, and which
packages and tooling to add (router, lens, testing, [devtools](/devtools), and Biome for
lint + format) — then:

```
cd my-app
npm install   # unless you let it install for you
npm run dev
```

Open the address it prints and you have a working Ramonda app. (`pnpm create ramonda`
and `yarn create ramonda` work too.)

If you're starting fresh, stop here — the rest of this page is for adding Ramonda to a
project you already have.

## Adding Ramonda to an existing project

```
npm install @ramonda/core
```

Ramonda has no runtime dependencies. It needs **two** things from your bundler, and
both fail confusingly when they're missing — so they come first.

### 1. The JSX factory is `h`

Ramonda's JSX compiles to calls to a function named `h`. Point your bundler's JSX
transform at `h` and have it auto-inject the import, so individual files never write
it themselves.

### 2. Decorators must be transpiled

Ramonda uses TC39 (stage-3) decorators. Chrome parses them natively — which is the
trap: a dev server can look fine while a production or server build fails with
`Invalid or unexpected token` on the first `@Host("div")`. Set a `target` your
bundler will down-level to, so the transform runs.

> You do **not** need to define `__DEV__`. The published `@ramonda/core` ships
> separate development and production builds and picks the right one automatically —
> you get the diagnostics on `dev` and a stripped build on `build`.

### A working Vite config

```js
import { defineConfig } from "vite";

export default defineConfig({
  esbuild: {
    jsxFactory: "h",
    jsxInject: `import { h } from '@ramonda/core'`,
    target: "es2022",
  },
});
```

### tsconfig

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

(`"jsx": "react"` is just TypeScript's built-in name for this classic `h()`-style
transform — it turns `<p/>` into `h("p")` and pulls in no library. `jsxFactory` is
what tells it to call `h`.)

And tell the type-checker that `h` is a global (the bundler injects it, so you never
import it by hand):

```ts
// global.d.ts
import { h as _h } from "@ramonda/core";

declare global {
  const h: typeof _h;
}
```

## Check it works

```demo:Counter
```

If that counts up, you're set.

## Next

- [Your first component](/guide/first-component).
