---
title: Checking your app
description: ramonda-check-context proves every context has a provider above it — before the app is ever opened.
section: Reference
order: 112
---

# Checking your app

A context that has no provider above it does not crash. The consumer falls back to the default, the
page renders, and someone reads a number that was never real. The framework reports it
([`RMD003`](/reference/diagnostics)) — but only once that component actually renders.

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
// package.json — run it first, so a broken app never reaches the bundler
"scripts": {
  "build": "ramonda-check-context && vite build"
}
```

A scaffolded project (`npm create ramonda`) already has both lines.

## What it looks like

```
$ ramonda-check-context

[ramonda-check-context] 2 consumer(s) with no provider above them:

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
[ramonda-check-context] 68 components, 4 contexts, 1 root(s) — every consumer has a provider above it.
```

## What it can see

It starts from each `bootstrap(<App />)` / `hydrateRoot(<App />)` and walks down, carrying the set
of contexts provided so far. It follows:

- **JSX** in your components — including children: `<Shell><Reader /></Shell>` puts `Reader` under
  `Shell`, because `Shell` is what decides where its children mount. A provider on `Shell` covers
  them.
- **[`list()`](/lists)** — `list({ each, as: Row })` renders `Row` where the list sits.
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

## The three checks, and where each one bites

They are not alternatives — each catches what the others cannot.

| | when it speaks | catches |
|---|---|---|
| `ramonda-check-context` | before the app runs | every path it can prove, exercised or not |
| [`@requiresContext`](/composition/context#declare-what-a-component-needs) | when the component **mounts** | dynamic composition the checker cannot resolve |
| [`RMD003`](/reference/diagnostics) | when the value is **read** | everything else, while you click around |

The static one is the only one that can speak about a branch nobody has opened yet.

## Using it directly

The analyzer is a normal export, if you want it in a script of your own:

```ts
import { analyzeProject } from "@ramonda/check";

const { issues, counts } = analyzeProject("tsconfig.json");
```

`typescript` is a peer dependency: the analyzer uses **your** compiler, so it reads your syntax and
your config rather than guessing at them.

## Next

- [Context](/composition/context) — providers, consumers, and declaring what a component needs.
- [Diagnostics](/reference/diagnostics) — what the framework reports while it runs.
