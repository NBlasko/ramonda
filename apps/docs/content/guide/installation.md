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
    jsx: "automatic",
    jsxImportSource: "@ramonda/core",
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
    "jsx": "react-jsx",
    "jsxImportSource": "@ramonda/core",
    "strict": true
  }
}
```

That is the whole of it. There is no factory to name, nothing to inject into every module, and no
`global.d.ts` declaring an identifier your source never mentions.

`"react-jsx"` is TypeScript's name for the **automatic** runtime, and it pulls in nothing from
React: the compiler adds one import per file, and `jsxImportSource` says where from. So a `.tsx`
file that writes `<p/>` gets `import { jsx } from "@ramonda/core/jsx-runtime"` at the top, written
for it.

The classic transform is what needs a name in scope, and a name in scope is a name that can be
taken. A bundler injects an identifier **only if it is not already bound**, so a helper of your own
called `h` silently won and every tag in that file called it — no error, no warning, a page quietly
built out of whatever your function returned. An import the compiler writes cannot be shadowed,
which is why this is the arrangement now.

### Building a vnode by hand

For the rare thing JSX cannot say — a tag name that is a value, children you have to spread — the
factory is exported as `__h`:

```tsx
import { __h } from "@ramonda/core";

const node = __h(tag, attributes, ...children);
```

Compiled JSX never calls it; that goes through the runtime import above. The name is deliberately
one you would not reach for by habit, because reaching for it usually means a tag would have been
clearer.

## Check it works

```demo:Counter
```

If that counts up, you're set.

## Next

- [Your first component](/guide/first-component).
