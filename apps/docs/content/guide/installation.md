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
packages and tooling to add ([router](/routing), [lens](/lens), [testing](/testing),
[devtools](/devtools), and Biome for lint + format) — then:

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
npm install -D @ramonda/build
```

Ramonda has no runtime dependencies. It needs three settings from your bundler, and
[`@ramonda/build`](/reference/build) carries them so you name none:

```js
// vite.config.ts
import { defineConfig } from "vite";
import { ramonda } from "@ramonda/build/vite";

export default defineConfig({ plugins: [ramonda()] });
```

For a build that is a script rather than a config — an esbuild bundle for a server —
the same settings spread in, and the plugin refuses a `target` that would break them:

```js
import { build } from "esbuild";
import { ramonda, ramondaOptions } from "@ramonda/build/esbuild";

await build({
  plugins: [ramonda()],
  ...ramondaOptions,
  entryPoints: ["src/entry-server.tsx"],
  bundle: true,
  platform: "node",
  outfile: "dist/server/entry-server.js",
});
```

The package is ESM only, so your project needs `"type": "module"` in its
package.json. A project from `create-ramonda` already has all of this.

> You do **not** need to define `__DEV__`. The published `@ramonda/core` ships
> separate development and production builds and picks the right one automatically —
> you get the diagnostics on `dev` and a stripped build on `build`.

### What those settings are, and why they are not yours to keep

**The JSX transform is the automatic one**, pointed at `@ramonda/core`. The compiler
writes one import per file; nothing is injected into your module scope. The section
below says why that matters.

**Decorators have to be compiled away.** `@state`, `@compute` and the rest are TC39
stage-3, and no engine parses them — so the build has to lower them, and whether it
does comes down to `target`. esbuild lowers for every target except `esnext`, and
`esnext` is also esbuild's **default**.

So a build that says nothing about a target has already chosen the one value that
breaks, and nothing tells you: it succeeds, prints no warning, and emits a file that
dies with `SyntaxError: Invalid or unexpected token` the first time a browser reads
it. The build and the browser are the two ends of that gap — everything in between
looks like it worked.

That shipped here once. It is why the settings live in a package rather than in a
paragraph asking you to copy three lines correctly, in every bundler config, forever.

### By hand, if you must

For a bundler `@ramonda/build` does not cover, the three settings are:

```js
// vite.config.ts — the long way
import { defineConfig } from "vite";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "@ramonda/core",
    // Anything except `esnext`. This is the one that decides whether the app runs.
    target: "es2022",
  },
});
```

`ramonda-check-bundle`, from [`@ramonda/check`](/reference/check), parses what your
build emitted and fails if any of it is unparseable — which is the second line of
defence for exactly this, and worth running whichever way you configure it.

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

`"react-jsx"` is TypeScript's own name for the **automatic** runtime — the name is historical and
nothing comes with it. The compiler adds one import per file, and `jsxImportSource` says where from.
So a `.tsx` file that writes `<p/>` gets `import { jsx } from "@ramonda/core/jsx-runtime"` at the
top, written for it.

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
