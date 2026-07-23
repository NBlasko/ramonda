---
title: Effects
description: "@effect runs after the DOM is committed and returns its own cleanup."
section: Core concepts
order: 37
---

# Effects

An `@effect` runs after the DOM is committed, and again whenever a signal it **read** changes.

```tsx
export class Feed extends Component {
  @state channel = "news";

  @effect
  subscribe() {
    const socket = connect(this.channel);
    return () => socket.close();
  }
}
```

## Return a function and it is the cleanup

That is the whole contract, and it holds on both ends: the cleanup runs **before** the effect
re-runs, and once more when the component is destroyed.

```demo:EffectCleanup
```

Measured on an effect that reads `this.channel`:

```
mount           connected to news
channel = "sport"   disconnected from news, connected to sport
unmount         disconnected from sport
```

So an effect that reads **no** signal runs exactly once and is cleaned up exactly once — which is
what a plain subscription wants. An effect that reads one follows it, disconnecting the old
target first.

Nothing else re-runs an effect. A re-render caused by other state leaves it alone.

## Client only

Effects never run during a server render. That is not a special case to remember — it is what
makes them the right place for anything that touches the browser: listeners, timers, sockets,
measurements.

It also means a value the server must produce cannot come from an effect. Use
`@create({ env: "server" })`; see [lifecycle](/concepts/lifecycle).

## Ordering

Within one commit, a component's effects run **after** its children's, and after its own
`@mount`. So an effect can rely on the whole subtree below it being mounted and on
`@onElement` listeners being attached.

That holds on every path — a fresh build, a hydrated page, and a re-render that creates a child.

## Writing what you read

An effect that writes a signal it also read does **not** loop:

```tsx
@effect
selfWriting() {
  this.count = this.count + 1;   // reads and writes the same signal
}
```

After the effect runs, the framework detaches any signal the effect **itself mutated** from that
effect's dependencies. So this fires once and then stops.

It is worth knowing rather than relying on, for one reason: the loop you would have been able to
find yourself simply does not happen, so nothing tells you the code is confused. It runs once,
quietly, and reads as if it were meant to.

## The loop that is real: two effects

The guard is per effect, not across effects. Two effects writing what the other reads is a
genuine cycle, and nothing at the dependency level breaks it:

```tsx
@effect
a() { this.x = this.y + 1; }

@effect
b() { this.y = this.x + 1; }
```

Each write schedules the other, forever. That is stopped by a **count**, not by dependency
tracking:

- **Development** — `RMD009` names the component and stops it after a small number of rebuilds.
- **Production** — a hard limit on rebuilds per drain, which throws.

Production throws deliberately. A loop that only appears with real data would never have been
seen in development, and a frozen tab is a worse outcome than an error — it takes the browser
with it and leaves nothing to debug.

The shape to avoid is the same either way: read what drives the effect, write something else.

## Effects underneath everything else

`@onElement`, `@onWindow`, `@onDocument`, `@interval` and `@timeout` are all built on this
primitive — they subscribe on mount and clean up on unmount. If you need one of your own, that
is what [`createSubscriptionDecorator`](/concepts/own-decorators) is for.

## Next

- [Events](/concepts/events) · [Timers](/concepts/timers) — the decorators built on this.
