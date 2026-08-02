# @ramonda/check

Proves every context consumer has a provider above it — before the app is ever opened.

[![npm](https://img.shields.io/npm/v/%40ramonda%2Fcheck)](https://www.npmjs.com/package/@ramonda/check)
[![license](https://img.shields.io/npm/l/%40ramonda%2Fcheck)](https://github.com/NBlasko/ramonda/blob/main/LICENSE)

```bash
npm add -D @ramonda/check
```

```jsonc
// package.json — first, so a broken app never reaches the bundler
"scripts": {
  "build": "ramonda-check-context && vite build"
}
```

A project scaffolded with `npm create ramonda` already has both lines.

## The fault it exists for

A context with no provider above it does not crash. The consumer falls back to the default, the
page renders, and someone reads a number that was never real.

The framework reports that at runtime (`RMD003`) — but only once the component actually mounts.
So a panel behind a condition nobody clicked, or a page in a chunk nobody opened, ships with the
fault and nothing has said a word. The commonest way to get there is a **reorder**: the provider
moves a level, the consumer stays, and everything still looks fine.

```
$ ramonda-check-context

[ramonda-check-context] 1 consumer(s) with no provider above them:

  src/pages/Account.tsx:14:9
    <Account> consumes "Session" — nothing provides it on this path:
    App → Layout → Account
```

The path is the useful part: it says where the provider has to go.

## What it follows

It starts at each `bootstrap(<App />)` / `hydrateRoot(<App />)` and walks down carrying the set of
contexts provided so far:

- **JSX**, including children — `<Shell><Reader /></Shell>` puts `Reader` under `Shell`, because
  `Shell` decides where its children mount, so a provider on `Shell` covers them.
- **`list({ each, as: Row })`** — `Row` renders where the list sits.
- **Route tables** — the views in `createRoutes` hang under the `<RouteOutlet>` that renders them.
- **Contexts a hook carries** — `this.use(Router)` provides the route context because `Router`
  itself does. Hooks built out of hooks resolve too.

## What it stays quiet about, on purpose

**It reports only what it can prove.** A component picked out of a variable or a registry, a hook
chosen at runtime — it goes quiet for that path rather than guess.

That is what makes it safe to fail a build on. A checker that cries wolf gets deleted; this one's
reports are real broken paths, never maybes. The honest cost: a fully dynamic composition is not
checked, and neither is a context that reaches a component only through a third-party hook's
internals.

A context created with `{ optional: true }` — its default is a real answer, not a stand-in for a
missing provider — is not reported here, exactly as it is not reported at runtime.

For the dynamic remainder, the framework reports `RMD003` when the component **mounts**.

## As a library

```ts
import { analyzeProject } from "@ramonda/check";

const { issues, counts } = analyzeProject("tsconfig.json");
```

`typescript` is a peer dependency: the analyzer runs on **your** compiler, so it reads your syntax
and your config rather than guessing at them.

It reads your config with two options overridden — `noLib` and `types` — because it asks the
checker only where a symbol was declared, never what type anything is. Skipping the lib and the
`@types/*` packages is most of its running time, which matters when it goes first in a build. It
does not typecheck and never did; that is `tsc`'s job.

## Docs

**https://ramonda.pages.dev/reference/check**
