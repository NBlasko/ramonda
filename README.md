# Ramonda 🌸

A TypeScript UI framework built on **class components, decorators, and signals**,
with a region-aware virtual DOM and first-class server rendering.

> **Status: early.** The API is taking shape and versions are `0.0.x`. It is real
> and tested, but not yet stable — expect changes.

📖 **Documentation: [ramonda.pages.dev](https://ramonda.pages.dev)**

## What it is

```tsx
import { Component, Host, state, onElement } from "@ramonda/core";

@Host("button")
export class Counter extends Component {
  @state count = 0;

  @onElement("click")
  bump() {
    this.count++;
  }

  render() {
    return <span>Clicked {this.count} times</span>;
  }
}
```

A few ideas set Ramonda apart:

- **One component, one element.** A component *is* a single DOM node (its host),
  so the JSX maps straight to the DOM you inspect — there is no wrapper, no
  fragment ambiguity, and the parent–child rules the browser enforces are the
  rules you write against.
- **Decorators, not conventions.** `@state`, `@compute`, `@mount`, `@destroy`,
  `@effect`, `@interval`, `@onElement`… behavior is declared on ordinary methods
  and fields.
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
| [`@ramonda/lens`](packages/lens) | Immutable deep updates by path, via structural sharing |
| [`@ramonda/testing-library`](packages/testing-library) | Testing utilities, built on `@testing-library/dom` |

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
