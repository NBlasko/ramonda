---
title: Configuring your build
description: "@ramonda/build carries the three bundler settings an app needs — as a Vite plugin, as esbuild options, and as the settings themselves for a bundler with no adapter."
section: Reference
order: 113
---

# Configuring your build

Three settings decide whether a Ramonda app runs at all. One of them has a default that breaks it,
and gets no warning from anywhere. So they are not yours to keep in step by hand: `@ramonda/build`
owns them, and your app names none.

```bash
npm add -D @ramonda/build
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { ramonda } from "@ramonda/build/vite";

export default defineConfig({ plugins: [ramonda()] });
```

A project scaffolded with `npm create ramonda` already has this, and so does the tsconfig below it.

The package is ESM only, so your project needs `"type": "module"` in its package.json — without it
Vite loads the config as CommonJS and stops with *"This package is ESM only but it was tried to load
by `require`"*.

## What it sets

| setting | value | why |
|---|---|---|
| `jsx` | `"automatic"` | JSX compiles through the runtime import, so there is no factory to name. |
| `jsxImportSource` | `"@ramonda/core"` | Where that import comes from. |
| `target` | `"es2022"` | Anything except `esnext` — see below. |

The first two have to say the same thing as `jsx` and `jsxImportSource` in your `tsconfig.json`,
which is the other reason they are worth taking from one place: two halves of one decision, in two
files, with nothing checking that they agree.

The third is the one nobody would guess. `@state`, `@compute` and the rest are TC39 decorators, and
**no engine can parse them** — so a bundler has to compile them away, and whether it does comes down
to `target`. esbuild lowers them for every target except `esnext`, and `esnext` is also esbuild's
**default**. A build that says nothing has therefore already chosen the one value that breaks, and
nothing tells you: it succeeds, warns about nothing, and emits a file that dies with `SyntaxError:
Invalid or unexpected token` the first time a browser reads it.

That shipped here once. [Installation](/guide/installation#what-those-settings-are-and-why-they-are-not-yours-to-keep)
tells that story at length; this page is about the package that closes it.

## Vite

```ts
import { defineConfig } from "vite";
import { ramonda } from "@ramonda/build/vite";

export default defineConfig({ plugins: [ramonda()] });
```

The plugin declares `enforce: "pre"`, which puts it **first** — and since Vite merges each plugin's
config over the one before, first is the easiest position to overrule, not the hardest. That is the
side it wants to be on. This package exists so that a transform setting cannot be reversed in
silence; quietly outranking whatever your app added on purpose would be the same fault pointed the
other way.

So it states the settings, and then reads the argument's result: `configResolved` runs after every
plugin has had its turn, and checks what they actually agreed on. If something later in the list won
with a target that leaves the decorators in, that is where you hear about it — reported with the
value that won, rather than the value this plugin asked for.

## esbuild

For a build you call yourself, spread the options in:

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

For a build assembled somewhere you cannot reach — a tool that calls esbuild for you and takes
plugins — there is the plugin form, which fills in whatever the build did not set:

```ts
import { build } from "esbuild";
import { ramonda } from "@ramonda/build/esbuild";

await build({ plugins: [ramonda()], entryPoints: ["src/entry-server.tsx"], bundle: true });
```

There is one asymmetry with Vite worth knowing. Vite's config may leave `target` unsaid and mean it;
esbuild's default *is* `esnext`, so a build that never mentions a target has already chosen the
broken one. That is why an unset target here is filled in rather than left alone.

## It refuses rather than corrects

If your config names any of the three as something Ramonda cannot work with, the build stops and
tells you which line:

```
[ramonda] `esbuild.target` in your Vite config has `"esnext"`, and that leaves Ramonda's
decorators in the output.
…
Set it to `es2022`, or remove it and let this plugin do it.

This is refused rather than corrected because you asked for something specific, and the line
you asked it on is the one that has to change.
```

Three shapes get refused, and each says something different because the useful sentence — what to do
about it — is different in each:

| what you wrote | what it says |
|---|---|
| a `target` that leaves the decorators in | set it to `es2022`, or remove it |
| `jsx` or `jsxImportSource` that disagrees | remove it, and make your tsconfig agree |
| `esbuild: false` | remove that line — there is no target to set while the transform is off |

It could win every one of those arguments silently, since Vite merges a plugin's config over the
user's. That is exactly why it does not. A setting that gets quietly reversed is a setting you
cannot reason about, and the next person to write `esnext` there deserves to find out from the build
rather than from a browser.

A setting that already agrees is left alone, for the same reason: it was a real choice, and handing
it back would only replace your line with an identical one.

Both adapters answer all of this from the same place, so Vite and esbuild cannot disagree about your
config. They did drift apart once — the Vite half replaced a disagreeing value and the esbuild half
kept it, so the same config got opposite treatment depending on which bundler read it, and neither
said a word.

## Another bundler

There is no adapter for webpack, rspack or rollup, because none of them is a bundler Ramonda is
built and tested against, and an adapter nobody exercises is a promise nobody is keeping.

The settings themselves are exported, so wiring one up yourself is short:

```ts
import { RAMONDA_TRANSFORM, lowersDecorators } from "@ramonda/build";

const ok = lowersDecorators(RAMONDA_TRANSFORM.target);
```

`RAMONDA_TRANSFORM` is the three values above. `lowersDecorators(target)` answers whether a given
target compiles the decorators away — including for a list like `["es2022", "chrome100"]`, which
esbuild reads as the intersection of its entries: a list lowers if even one entry is something other
than `esnext`.

The rule is the same for **`tsc`** as for esbuild, which matters here because a webpack or rollup
toolchain usually lowers TypeScript with `tsc`: `esnext` leaves the decorators in, and every target
below it compiles them away. Both compilers are run against that table in this package's tests, so
it is a measurement rather than a recollection — but it is only those two. If you lower with
something else, run `ramonda-check-bundle` over the output and let the artifact answer.

## And then check the output

Configuration is not proof. Whatever you configure, and however you configure it, the question that
actually matters is whether the file your build emitted can be parsed — and there is a command that
reads the artifact instead of the config:

```jsonc
// package.json
"scripts": {
  "build": "ramonda-check && vite build && ramonda-check-bundle dist"
}
```

[`ramonda-check-bundle`](/reference/check#the-bundle-that-did-not-parse) parses every file your build
emitted and fails the build instead of the browser. It needs to know nothing about how the artifact
was made, which is what makes it worth running whichever bundler you use.

## Next

- [Installation](/guide/installation) — the settings in context, and the tsconfig that has to agree.
- [Checking your app](/reference/check) — the source check and the bundle check.
