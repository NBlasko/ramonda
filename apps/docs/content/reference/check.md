---
title: Checking your app
description: ramonda-check reads your source and proves what a running page would not tell you; ramonda-check-bundle reads what your build emitted.
section: Reference
order: 112
---

# Checking your app

A context that has no provider above it does not crash. The consumer falls back to the default, the
page renders, and someone reads a number that was never real. The framework reports it
([`RMD003`](/reference/diagnostics)) — but only once that component actually mounts.

That is the gap. A panel behind a condition nobody clicked, a page in a chunk nobody opened: the
fault ships, and nothing has said a word. The commonest way to get there is a **reorder** — the
provider moves up or down a level, the consumer stays where it was, and everything still looks
fine.

`@ramonda/check` closes it from the other side: it reads your source and **proves** the provider is
above the consumer, before anything runs.

```bash
npm add -D @ramonda/check
```

```jsonc
// package.json — the source before the bundler, the output after it
"scripts": {
  "build": "ramonda-check && vite build && ramonda-check-bundle dist"
}
```

A scaffolded project (`npm create ramonda`) already has all of this. The package installs two
commands: `ramonda-check`, which reads your **source** and is what most of this page is about, and
[`ramonda-check-bundle`](#the-bundle-that-did-not-parse), which reads what your build **emitted**.

## What it looks like

```
$ ramonda-check

[ramonda-check] 2 consumer(s) with no provider above them:

  src/pages/Account.tsx:14:9
    <Account> consumes "Session" — nothing provides it on this path:
    App → Layout → Account

Mount the matching Provider on a component above it — a context reaches only the providing
component and its descendants.
```

It names the file, the line, and **the path** — which is the part that tells you where the provider
has to go.

When everything is connected it says so and exits zero:

```
[ramonda-check] 68 components, 4 contexts, 1 root(s) — every consumer has a provider above it.
```

## What it can see

It starts from each `bootstrap(<App />)` / `hydrateRoot(<App />)` and walks down, carrying the set
of contexts provided so far. It follows:

- **JSX** in your components — including children: `<Shell><Reader /></Shell>` puts `Reader` under
  `Shell`, because `Shell` is what decides where its children mount. A provider on `Shell` covers
  them.
- **[`list()`](/lists)** — `list(each, (item) => <Row item={item} />)` renders `Row` where the list sits.
- **[Route tables](/routing)** — the views in `createRoutes` hang under the `<RouteOutlet>` that
  renders them, which is also what publishes the matched params.
- **Contexts a hook carries** — `this.use(Router)` provides the route context because `Router`
  itself provides it. A hook built out of hooks resolves too.

## What it stays quiet about — on purpose

**It reports only what it can prove.** If it cannot resolve something — a component picked out of a
variable or a registry, a hook chosen at runtime — it goes quiet for that path rather than guess.

That is what makes it safe to put in a build. A checker that cries wolf gets removed; this one's
reports are real broken paths, never maybes. The cost is honest: a fully dynamic composition is not
checked, and neither is context that reaches a component only through a third-party hook's internals.

It also honours [`optional`](/composition/context#when-the-default-is-a-real-answer): a context whose
author declared its default a real answer is never reported here either. The two checks agree on
purpose — a build that fails on what the app is documented to do is worse than no check at all.

## The two checks, and where each one bites

They are not alternatives — each catches what the other cannot.

| | when it speaks | catches |
|---|---|---|
| `ramonda-check` | before the app runs | every path it can prove, exercised or not |
| [`RMD003`](/reference/diagnostics) | when the component **mounts** | dynamic composition the checker cannot resolve |

The static one is the only one that can speak about a branch nobody has opened yet. The runtime one
is the only one that sees a tree assembled at runtime.

## Using it directly

The analyzer is a normal export, if you want it in a script of your own:

```ts
import { analyzeProject } from "@ramonda/check";

const { issues, counts } = analyzeProject("tsconfig.json");
```

`typescript` is a peer dependency: the analyzer uses **your** compiler, so it reads your syntax and
your config rather than guessing at them.

### It does not typecheck

It asks the compiler only where a symbol was declared — never what type anything is. So it reads
your config with `noLib` and `types` overridden, and skips the whole TypeScript lib and every
`@types/*` package you have installed. That is most of what a run would otherwise cost, which
matters for something that goes first in a build.

A project that does not compile is still `tsc`'s news to break. Run both.

## What loads when, and what a change moved

The same reading of the same graph answers a question no check does: what the browser downloads
before it does anything.

A bundler splits at a dynamic import and nowhere else, so this splits at a `lazy` prop and nowhere
else.

```
$ ramonda-check tsconfig.json --split

[ramonda-check] what loads when — @ramonda/docs

  before anything      16 declaration(s) in 8 file(s)
  loaded on demand     76 split point(s)
  shared between them  55 declaration(s)
```

What a chunk reaches is split three ways, and each is a different claim: **already** in the first
payload and free, **shared** with another split point and downloaded once for both, and **its own**,
which only that one pays for.

It counts declarations, never bytes. Nothing here has weighed a bundle; for kilobytes, ask the
bundler.

`--diff` compares the run against a graph written earlier, and the number it exists for is the one
below:

```
$ ramonda-check tsconfig.json --diff .ramonda/main.json

  nodes  +0  -0        edges  +1  -0
  before anything: 16 → 72 declaration(s) (+56)

  56 in the first payload now, and not before:
    ErrorBoundary — @ramonda/core/src/base/ErrorBoundary.ts:16:1
    …
```

That is one added import line. A diff of the source shows the line; nothing in it shows the
fifty-six components that now arrive with the first page.

Both flags describe. Neither fails a build.

## A split point that was meant, and is not there

The same fact from the other side. A bundler splits at a dynamic import and **only when it can read
the path at build time** — so `import(specifier)` is not a split point at all:

```
[ramonda-check] 1 dynamic import(s) the bundler cannot split:

  src/Search.tsx:103:30
    import(specifier) — the path is not a literal.
```

There is no chunk. The module is pulled into the caller's chunk, or left out of the build entirely
and looked for at run time — which works on a dev server, where the source is served as it sits, and
404s in production, where nothing emitted it. The build says nothing either way.

If it is deliberate, say so and the report stops. Either the bundler's own marker, which you
probably already need for the build to be quiet:

```ts
const load = () => import(/* @vite-ignore */ specifier);
```

or this package's annotation, which also keeps the reason where the next reader will find it:

```ts
// ramonda-check-ignore the panel's specifier is built, so the build cannot follow it
const load = () => import(specifier);
```

Measured across this repository when the rule was written: 88 dynamic imports with a literal path
and 3 without, every one of the three already marked. A rule that reported those would have opened
by crying wolf at three deliberate decisions.

## The bundle that did not parse

`@state`, `@compute` and the rest are TC39 decorators, which no engine can parse. Your bundler has
to transform them away, and whether it does comes down to one setting — `target`. Below `esnext`,
esbuild rewrites them into helpers. At `esnext` it leaves them exactly as written.

Nothing tells you when that goes wrong. The build succeeds, prints no warning, and emits a file that
dies with `SyntaxError: Invalid or unexpected token` the moment a browser reads it. It happened
here: the transform was being applied as a side effect of an unrelated option, and removing that
option broke the output in silence.

`ramonda-check-bundle` reads the build's output and answers the one question that matters about it:

```
$ ramonda-check-bundle dist

[check-bundle] 1 of 42 emitted file(s) do not parse:

  dist/assets/index-Bq7xk.js
    SyntaxError: Invalid or unexpected token
```

Point it at directories or files, as many as you like; it walks directories and reads every `.js`,
`.mjs` and `.cjs`. Finding no JavaScript at all is a failure rather than a pass — a build that
silently emitted nothing is the same shape of bug.

### Why it parses instead of searching for `@`

Searching for decorator syntax is both weaker and wrong. Weaker, because a surviving decorator is
only one way to emit something an engine cannot read. Wrong, because a bundle may legitimately
**contain** decorator text inside a string: Ramonda's own diagnostics put `@Host("div")` into a
suggestion message, so it appears in any bundle that ships them, as data. A parser does not care
what is inside a string — and that is exactly the distinction being asked for.

The parser is `node --check`, on purpose. The failure being guarded against is "no engine can read
this", and that is the engine.

### If it fires

Look at your bundler's `target`. Every value below `esnext` compiles the decorators away; `esnext`
itself, which is also esbuild's default, is the one that does not.

A scaffolded project does not set it by hand at all — [`@ramonda/build`](/reference/build) carries
it, along with `jsx` and `jsxImportSource`, into both the Vite config and the esbuild build. If you
configure the transform yourself, that package is the shorter way to get it right, and it refuses a
`target` that would bring you back to this error instead of letting the build proceed.

## Next

- [Context](/composition/context) — providers, consumers, and declaring what a component needs.
- [Diagnostics](/reference/diagnostics) — what the framework reports while it runs.
