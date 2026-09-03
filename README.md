# Ramonda 🌸

A UI framework. **Explicit. Predictable. Readable.**

[![CI](https://img.shields.io/github/actions/workflow/status/NBlasko/ramonda/ci.yml?branch=main&label=CI)](https://github.com/NBlasko/ramonda/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/coverallsCoverage/github/NBlasko/ramonda?branch=main)](https://coveralls.io/github/NBlasko/ramonda?branch=main)
[![npm](https://img.shields.io/npm/v/%40ramonda%2Fcore?label=%40ramonda%2Fcore)](https://www.npmjs.com/package/@ramonda/core)
[![types](https://img.shields.io/npm/types/%40ramonda%2Fcore)](https://www.npmjs.com/package/@ramonda/core)
[![license](https://img.shields.io/github/license/NBlasko/ramonda)](./LICENSE)

> **Status: `0.x` — still being explored.** The API changes freely between
> releases while the design is being worked out. It is real and tested, and it is
> on npm so it can be installed and tried, but it is not asking to be adopted yet.
>
> **`1.0` is the line.** From there the interfaces hold: backward compatibility
> becomes a rule rather than a courtesy, and the work turns to performance and
> bugs. The point of these `0.x` months is to arrive at an API worth keeping,
> because the way it works then is the way it goes on working.
>
> Until then a breaking change ships as a **minor**, so `0.23` → `0.24` may ask you
> to change something and `0.23.1` → `0.23.2` never will.
> **[Upgrading](https://ramonda.dev/reference/upgrading)** is the whole of it.

📖 **Documentation: [ramonda.dev](https://ramonda.dev)**

## What it is

```tsx
import { Component, state } from "@ramonda/core";

export class Counter extends Component {
  @state count = 0;

  bump() {
    this.count++;
  }

  render() {
    return <button onclick={this.bump}>Clicked {this.count} times</button>;
  }
}
```

A few ideas set Ramonda apart:

- **One JSX tag, one DOM node.** A component's markup is what its `render()`
  returns and nothing else — one element, several, or none — so the JSX maps
  straight to the DOM you inspect. There is no wrapper element, no fragment tag
  to write, and two `<td>` from one component sit inside the `<tr>`.
- **Decorators, not conventions.** `@state`, `@compute`, `@mounted`, `@destroyed`,
  `@updated`, `@interval`… behavior is declared on ordinary methods and fields.
- **Signals under the hood.** Reactivity tracks reads, so a `@compute`
  recomputes only when something it actually read changed — no dependency arrays.
- **Region-aware diffing.** Lists get identity from their items, not from
  hand-written keys, and state never lands on the wrong row.
- **SSR is not bolted on.** The server render and the client render are the same
  code; hydration adopts the server's DOM, and mismatches report themselves.
- **Diagnostics that teach.** Development builds catch the mistakes the design is
  meant to prevent (the `RMD0xx` codes) and say what to do instead.

## Packages

| Package | What it is |
|---|---|
| [`@ramonda/core`](packages/core) | The framework: components, reactivity, VDOM, SSR/hydration |
| [`@ramonda/router`](packages/router) | State-first client-side router with nested outlets |
| [`@ramonda/query`](packages/query) | Async state: cached, deduped, race-free queries and mutations |
| [`@ramonda/form`](packages/form) | Forms: typed field paths, Standard Schema validation, stable array rows |
| [`@ramonda/lens`](packages/lens) | Immutable deep updates by path, via structural sharing |
| [`@ramonda/server`](packages/server) | The DOM and request plumbing an SSR server needs |
| [`@ramonda/build`](packages/build) | The three bundler settings an app needs, as a Vite and an esbuild plugin |
| [`@ramonda/check`](packages/check) | Static checks over your source, and over what your build emitted |
| [`@ramonda/devtools`](packages/devtools) | The in-page inspector panel |
| [`@ramonda/testing-library`](packages/testing-library) | Testing utilities, built on `@testing-library/dom` |
| [`create-ramonda`](packages/create-ramonda) | The scaffolder — `npm create ramonda` |

## Developing

A pnpm + Turborepo monorepo.

```sh
pnpm install
pnpm build          # build every package and app
pnpm test           # run every test suite (turbo)
pnpm check-types    # type-check
pnpm lint           # oxlint
pnpm format         # biome
```

The documentation site lives in [`apps/docs`](apps/docs) and runs its own
documented features — it is server-rendered with Ramonda, hydrated on the client,
and searchable.

## License

[MIT](LICENSE) © Nikola Blagojević
