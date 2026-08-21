---
title: Client, server, shared
description: The env option says which side each piece of setup runs on.
section: Server rendering
order: 85
---

# Client, server, shared

When you render on both the server and the browser, some setup should run on both,
some only in the browser, and some only on the server. Every lifecycle decorator takes
an `env` to say which:

```tsx
@created
init() {} // "shared" — both sides (the default)

@created({ env: "client" })
startPolling() {} // only in the browser

@created({ env: "server" })
stampBuildTime() {} // only during a server render
```

| | server render | browser |
|---|---|---|
| `"shared"` (default) | ✓ | ✓ |
| `"client"` | | ✓ |
| `"server"` | ✓ | |

(Subscriptions — `@interval`, timers, `@onWindow`, your own — have no `env`; they are
always client-only. That is why a subscription never leaks into a server render. The
[`Timer`](/concepts/timers#a-timer-that-starts-when-you-say) hook has no `env` either, for
the same reason and by a different route: `after` and `repeat` do nothing during a server
render, so a method that arms one is safe to call from `shared` code.)

## Knowing the side inside a shared method

Sometimes a shared method runs mostly the same both ways but must skip one step on one
side — fetch on the client, not during the server render. Rather than split it in two,
each lifecycle method receives its side as an argument:

```tsx
import { RenderEnv } from "@ramonda/core";

@mounted
async load(env: RenderEnv) {
  if (env === "server") return;            // the client fetches after hydration
  this.data = await fetch(`/api/thing/${this.props.id}`).then((r) => r.json());
}
```

Read the argument, not `typeof window`: under server rendering the DOM is a shim, so
`window` and `document` exist there too and the check would lie. `env` is `"client"` or
`"server"`, and it stays correct even inside an `async` method after an `await`.

## `env` is not a security boundary

`env: "server"` chooses where code **runs**, not whether it **ships**. A `"server"`
method's body is part of your component, so it is bundled and sent to the browser like
everything else — someone can read it there even though it never executes. Never put a
secret (an API key, a private token, logic you don't want seen) in a `"server"`
lifecycle expecting the client can't reach it. If something must stay secret it lives
behind an API the browser calls; that boundary is the server, not a decorator.

## Which to use

- **`"shared"` for anything that produces the page** — reading props, seeding state,
  fetching. It runs on the server so the result is in the HTML, and on the client so a
  client-side navigation gets the same result.
- **`"client"` for anything that touches the browser** — `window`, `document`,
  `localStorage`, timers, geolocation — or anything that must not happen twice (an
  analytics event).
- **`"server"` for anything only the server can know** and shouldn't be recomputed — a
  build timestamp, a value read from a file. Pair it with `@persist` so it travels to
  the client.

```demo:PersistDemo
```

That timestamp was computed by the server and restored here; reloading doesn't change
it, because the client never recomputes it.

## The rule of thumb

**Anything with a matching teardown should be client-only.** A `window.addEventListener`
(or a counter you raise in `@created` and lower in `@destroyed`) has a setup and a
cleanup — but a server render never unmounts, so its cleanup never runs. Run those on
the client. (Both of these were real router bugs, from a lifecycle defaulting to
`shared` when the work was client-only.)

## Don't branch on the environment in `render()`

```tsx
render() {
  return typeof window === "undefined" ? <Server /> : <Client />; // ✗
}
```

That produces different output on the two sides by design — exactly what
[`RMD007`](/ssr/mismatches) reports. Decide by side in the lifecycle, where `env` says
so out loud.

## Next

- [Hydration mismatches](/ssr/mismatches).
