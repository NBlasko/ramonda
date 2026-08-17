# @ramonda/build

Three bundler settings decide whether a Ramonda app runs. This package owns them, so your app names
none of them.

[![npm](https://img.shields.io/npm/v/%40ramonda%2Fbuild)](https://www.npmjs.com/package/@ramonda/build)
[![license](https://img.shields.io/npm/l/%40ramonda%2Fbuild)](https://github.com/NBlasko/ramonda/blob/main/LICENSE)

```bash
npm add -D @ramonda/build
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { ramonda } from "@ramonda/build/vite";

export default defineConfig({ plugins: [ramonda()] });
```

A project scaffolded with `npm create ramonda` already has this.

The package is ESM only, so your project needs `"type": "module"` in its package.json — without it
Vite loads the config as CommonJS and stops with *"This package is ESM only but it was tried to load
by `require`"*. Scaffolded projects already declare it.

## The fault it exists for

`@state`, `@compute` and the rest are TC39 decorators. **No engine can parse them** — so a bundler
has to compile them away, and whether it does comes down to `target`. esbuild does it for every
target except `esnext`.

`esnext` is also esbuild's default. So a build that says nothing about a target has already picked
the one value that breaks, and nothing tells you: the build succeeds, prints no warning, and emits a
file that dies with `SyntaxError: Invalid or unexpected token` the first time a browser reads it.

That shipped here. It had been working by accident — an unrelated esbuild option was forcing every
module through the transform — and removing that option broke the output in silence.

A setting like that should not be something an app writes out by hand, in one place per bundler it
runs, and keeps in step with two others forever. So it is not.

## What it sets

| | |
|---|---|
| `jsx` | `"automatic"` — JSX compiles through the runtime import, so there is no factory to name |
| `jsxImportSource` | `"@ramonda/core"` — where that import comes from |
| `target` | `"es2022"` — the one above |

The first two have to agree with your `tsconfig.json`'s `jsx` and `jsxImportSource`, which is the
other reason they are worth taking from one place.

## Vite

```ts
import { defineConfig } from "vite";
import { ramonda } from "@ramonda/build/vite";

export default defineConfig({ plugins: [ramonda()] });
```

## esbuild

For a build you call yourself, spread the options:

```ts
import { build } from "esbuild";
import { ramondaOptions } from "@ramonda/build/esbuild";

await build({
  ...ramondaOptions,
  entryPoints: ["src/entry-client.tsx"],
  bundle: true,
  format: "esm",
  outfile: "dist/client.js",
});
```

For a build assembled somewhere you cannot reach, there is a plugin:

```ts
import { ramonda } from "@ramonda/build/esbuild";
```

It fills in whatever the build did not set.

## It refuses rather than corrects

If your config names any of the three as something Ramonda cannot work with — a `target` that would
leave the decorators in, or a `jsx` / `jsxImportSource` that disagrees — the build stops and tells
you which line:

```
[ramonda] `esbuild.target` in your Vite config has `"esnext"`, and that leaves Ramonda's
decorators in the output.
…
This is refused rather than corrected because you asked for something specific, and the line
you asked it on is the one that has to change.
```

It could win that argument silently — Vite merges a plugin's config over the user's — and that is
exactly why it does not. A setting that gets quietly reversed is a setting you cannot reason about.

A setting that already agrees is left alone, for the same reason: it was a real choice, and handing
it back would only replace your line with an identical one. Both adapters answer this from the same
place, so Vite and esbuild cannot disagree about your config.

## And then check the output

Configuration is not proof. `ramonda-check-bundle`, from
[`@ramonda/check`](https://www.npmjs.com/package/@ramonda/check), parses every file your build
emitted and fails the build instead of the browser:

```jsonc
"scripts": {
  "build": "ramonda-check && vite build && ramonda-check-bundle dist"
}
```

That one is worth reaching for whichever bundler you use. It reads the artifact rather than the
configuration, so it does not need to know how the artifact was made.

## Another bundler

There is no adapter for webpack, rspack or rollup, because none of them is a bundler Ramonda is
built and tested against, and an adapter nobody exercises is a promise nobody is keeping.

The settings themselves are exported, so wiring one up yourself is short:

```ts
import { RAMONDA_TRANSFORM, lowersDecorators } from "@ramonda/build";
```

`lowersDecorators(target)` answers whether a given target compiles the decorators away — including
for a list like `["es2022", "chrome100"]`, which esbuild reads as the intersection of its entries.

The rule is the same for **`tsc`** as for esbuild, which matters here because a webpack or rollup
toolchain usually lowers TypeScript with `tsc`: `esnext` leaves the decorators in, and every target
below it compiles them away. Both compilers are run against that table in this package's tests, so
it is a measurement rather than a recollection — but it is only those two. If you lower with
something else, run `ramonda-check-bundle` over the output and let the artifact answer.

## Docs

**https://ramonda.pages.dev/reference/build**
