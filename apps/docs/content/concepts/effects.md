---
title: Effects
description: Reach outside the component — a subscription, a socket — after it is on the page, and clean up.
section: Lifecycle and effects
order: 31
---

# Effects

An **effect** is code that reaches outside your component — opening a connection,
starting a subscription, listening to something — once the component is on the page.
It runs after the DOM is ready, and again whenever a piece of state it read changes.

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

## Return a function to clean up

Whatever you return from an effect is its cleanup. Ramonda runs it before the effect
runs again, and once more when the component is removed. So a connection opened in an
effect is always closed.

```demo:EffectCleanup
```

For the effect above, which reads `this.channel`:

```
mount              connect to news
channel = "sport"  close news, connect to sport
unmount            close sport
```

An effect that reads no state runs once and cleans up once — exactly what a plain
subscription wants. One that reads state re-runs when that state changes, closing the
old thing first. A re-render caused by *other* state leaves it alone.

## Effects run only in the browser

An effect never runs during a server render. That is what makes it the right home for
anything that touches the browser — listeners, timers, sockets, measurements. (A
value the *server* must produce can't come from an effect; use
`@create({ env: "server" })` — see [lifecycle](/concepts/lifecycle).)

## Don't make two effects chase each other (optional)

An effect that writes the same state it read does not loop — Ramonda stops it after
the first run. But two effects, each writing what the other reads, is a real loop:

```tsx
@effect
a() {
  this.x = this.y + 1;
}

@effect
b() {
  this.y = this.x + 1;
}
```

In development this is caught and reported (`RMD009`); in production a hard limit
throws rather than let the tab freeze. The rule that avoids it: read what drives the
effect, write something *else*.

## Built on effects

`@onWindow`, `@onDocument`, `@onElement`, `@interval` and `@timeout` are all effects
underneath — they set up on mount and clean up on unmount. To build your own, see
[custom decorators](/hooks/own-decorators).

## Next

- [Events](/concepts/events) · [Timers](/concepts/timers) — decorators built on this.
