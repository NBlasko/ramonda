---
title: Client, server, shared
description: The env option is how one component runs correctly on both sides.
section: Server rendering
order: 95
---

# Client, server, shared

Every lifecycle decorator takes an `env`.

```tsx
@create   // "shared" — both sides
init() { }

@create({ env: "client" })
startPolling() { }

@create({ env: "server" })
stampBuildTime() { }
```

| | server render | client |
|---|---|---|
| `"shared"` (default) | ✓ | ✓ |
| `"client"` | | ✓ |
| `"server"` | ✓ | |

**Effects have no `env`** — `@effect`, `@interval`, `@timeout`, `@onWindow`, `@onElement` are
always client-only. There is nothing to get wrong, and it is why a subscription never leaks into
a server render.

## Which to use

**`"shared"` for anything that produces the page.** Reading props, seeding state, fetching. It
runs on the server so the result is in the HTML, and on the client so a client-side navigation
gets the same result.

**`"client"` for anything that touches the browser.** `window`, `document`, `localStorage`,
timers, geolocation. Also for anything that must not be counted twice — an analytics event, an
instance counter.

**`"server"` for anything only the server can know**, and that must not be recomputed. A build
timestamp, a value read from the filesystem. Pair it with `@persist` so it travels.

```demo:PersistDemo
```

That timestamp was computed by the server at build time and restored here. Reloading does not
change it, because nothing on the client ever computes it.

## The mistakes this option exists to prevent

Both of these were real bugs in the router, and both were the same mistake — a lifecycle
defaulting to `shared` when the work was client-only:

**A listener attached on the server.** `window.addEventListener` in a shared `@create` runs during
the server render, against a DOM that is thrown away. Now it is an `@onWindow` effect, so it
cannot.

**A counter that leaked between renders.** `liveRouters++` in a shared `@create`, with the
decrement in `@destroy` — but *a server render never unmounts*. The counter climbed, and the
second `renderToString` in the same process threw "A second Router was mounted". Now it is
`@create({ env: "client" })`.

The pattern to watch for: **anything with a matching teardown should be client-only**, because
the server half of the pair never runs.

## Do not branch on the environment inside `render()`

```tsx
render() {
  return typeof window === "undefined" ? <Server /> : <Client />;   // ✗
}
```

That produces different output on the two sides by construction, which is exactly what
[`RMD007`](/ssr/mismatches) reports. Branching by side belongs in the lifecycle, where `env` says
so explicitly.

## Next

- [Hydration mismatches](/ssr/mismatches).
