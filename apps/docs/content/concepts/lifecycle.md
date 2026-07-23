---
title: Lifecycle
description: "@create, @mount and @destroy — what each guarantees, in what order, and on which side."
section: Core concepts
order: 34
---

# Lifecycle

Three decorators, on ordinary methods.

```tsx
export class Panel extends Component {
  @create
  init() { }

  @mount
  ready() { }

  @destroy
  bye() { }
}
```

```demo:LifecycleLog
```

## `@create` — building

Runs while the component is being built, before its element exists.

**For initialisation, not for side effects**, and both halves of that are rules rather than
style preferences:

**There is no DOM yet.** The host element is created after `@create`, and inserted by the caller
after that. A `document.querySelector` here finds nothing of this component — and during a
*replacement* it finds the outgoing instance instead, which is worse than finding nothing.

**The instance it replaces is still alive.** On any replacement — a `key` change, a swapped
class, a host tag resolved from props — the new `@create` runs before the old `@destroy`.
Anything exclusive taken here (a lock, a subscription keyed by identity) would briefly overlap
itself.

So: read props, seed state, compute. Nothing that reaches outside.

## `@mount` — committed

Runs after the DOM this commit built is in the document. Measure, focus, hand the node to a
chart library — this is where that belongs.

Within one commit:

- every child's `@mount` before its parent's;
- a component's `@mount` before its effects, so `@onElement` listeners are already attached.

A component built and torn down inside the same commit never mounts at all.

## `@destroy` — teardown

Runs on unmount, **while reactive dependencies are still readable**, so you can still read state
and computed values.

It runs exactly once, and it runs even for a component whose **build failed** — a throw in
`render()` or in `@create` itself. So `@destroy` must tolerate a half-built instance. That was
chosen over never cleaning up such a component, because whatever `@create` took would otherwise
leak for the life of the page.

A throw inside `@destroy` is reported and does not stop the rest of the cleanup.

## Order, measured

For a parent containing a child, on a fresh mount:

```
parent @create
parent render
child  @create
child  render
child  @mount
parent @mount
```

Children mount before parents, so a parent's `@mount` can rely on its children being in the
document.

**Effects follow the same shape** — a component's effects run after its children's, on every
path: a fresh build, a hydrated page, and a re-render that creates a child. That was not always
true; two of those three paths ran parent-first until it was measured and fixed.

## Where it runs: `env`

Each lifecycle decorator takes an `env`.

```tsx
@create({ env: "client" })
startPolling() { }

@create({ env: "server" })
stampBuildTime() { }

@create   // "shared" — both
init() { }
```

| | server render | client |
|---|---|---|
| `"shared"` (default) | yes | yes |
| `"client"` | no | yes |
| `"server"` | yes | no |

Anything that touches `window`, starts a timer or subscribes to something belongs on the client.

**Effects have no `env`** — they are always client-only, so there is nothing to get wrong. That
also means an `@effect` never runs during a server render, which is why a value the server must
produce goes in `@create({ env: "server" })`.

```demo:PersistDemo
```

## Timers are lifecycle too

`@interval(ms)` and `@timeout(ms)` start on mount and are cleared on unmount. There is no
cleanup to remember:

```tsx
@interval(1000)
tick() { this.now = new Date(); }
```

```demo:IntervalClock
```

A bare `setTimeout` in `@mount` would still fire after the component was gone, and write state
into something that no longer exists. In development, a timer still running after teardown is
reported as `RMD006`.

## Next

- [The host element](/concepts/host) — which element `@mount` is talking about.
