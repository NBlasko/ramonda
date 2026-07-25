---
title: Lifecycle
description: Run code when a component is created, shown on the page, and removed.
section: Lifecycle and effects
order: 30
---

# Lifecycle

A component has three moments in its life: it is **created**, it is **shown** on the
page, and later it is **removed**. You can run code at each one by putting a decorator
on a method.

```tsx
export class Panel extends Component {
  @create
  init() {} // being created

  @mount
  ready() {} // now on the page

  @destroy
  bye() {} // being removed
}
```

```demo:LifecycleLog
```

## `@create` — being built

Runs while the component is being created, *before* its element exists. This is where
you set up from your props and seed your state.

Two things are deliberately off-limits here:

- **There is no element yet.** Don't try to find or measure this component's DOM in
  `@create` — it isn't on the page. That is what `@mount` is for.
- **Keep it to setup.** Read props, set state, compute. Leave subscriptions, focus,
  and measurements for `@mount`.

## `@mount` — on the page

Runs once the component's DOM is in the document. This is where you reach the real
page: focus an input, measure an element, hand a node to a chart library.

Children mount before their parent, so by the time a parent's `@mount` runs, its
children are already on the page.

## `@destroy` — being removed

Runs when the component is removed. Your state and computed values are still readable,
so you can clean up based on them. It runs exactly once — even for a component that
failed while building — so write it to tolerate a half-set-up instance.

## Server vs. browser: `env`

`@create`, `@mount` and `@destroy` can be limited to one side with `env`:

```tsx
@create({ env: "client" })
startPolling() {} // only in the browser

@create({ env: "server" })
stampBuildTime() {} // only during a server render

@create
init() {} // both — the default
```

| | server render | browser |
|---|---|---|
| `"shared"` (default) | yes | yes |
| `"client"` | no | yes |
| `"server"` | yes | no |

Anything that touches `window`, starts a timer, or opens a connection belongs on the
client. (Effects — the next page — are always client-only, so you rarely need `env`
for them.)

### The method also receives `env`

When a method needs to know which side it is on — rather than skip a side entirely —
it is handed `env` as an argument, `"client"` or `"server"`:

```tsx
@mount
setup(env: RenderEnv) {
  if (env === "server") return; // nothing to wire up during a server render
  this.observer = new IntersectionObserver(/* … */);
}
```

Prefer this to a `typeof window` check: a server render runs under a DOM shim where
`window` exists, so that check cannot tell the two sides apart — `env` always can.
The parameter is optional; a method that ignores it is unaffected. More in
[client / server / shared](/ssr/env).

## Timers are lifecycle too

`@interval(ms)` and `@timeout(ms)` start when the component mounts and stop when it is
removed — no cleanup to remember:

```tsx
@state now = "";

@interval(1000)
tick() {
  this.now = new Date().toLocaleTimeString();
}
```

```demo:IntervalClock
```

See [timers](/concepts/timers).

## Next

- [Effects](/concepts/effects) — reacting to state, with cleanup.
- [The host element](/concepts/host) — the element `@mount` is talking about.
