---
title: Hooks
description: Reusable state, lifecycle and effects — like a component, but with no element of its own.
section: Hooks
order: 50
---

# Hooks

A **hook** is a bundle of state, lifecycle and effects that a component can reuse —
like a component, but with **no element of its own**. It is how you share stateful
behaviour — a clock, a subscription, pagination — between components without each one
reinventing it.

```tsx
import { Hook, state, mount, interval } from "@ramonda/core";

export class Clock extends Hook {
  @state now: Date | null = null;

  @mount({ env: "client" })
  start() {
    this.now = new Date();
  }

  @interval(1000)
  tick() {
    this.now = new Date();
  }
}
```

A component uses one with `this.use()`:

```tsx
export class Header extends Component {
  clock = this.use(Clock);

  render() {
    return <time>{this.clock.now?.toLocaleTimeString() ?? "—"}</time>;
  }
}
```

Now any component that wants a live clock just uses `Clock` — the ticking and the
cleanup live in one place.

Notice `now` starts empty and is filled in on the client, not in the field. `new Date()`
in the field would run on the server too and give a different time than the browser, and
a server-rendered page would flag the mismatch. Seeding it in `@mount({ env: "client" })`
keeps the two in step. (In a client-only app there is no server, so a plain
`@state now = new Date()` would work — but this way is safe everywhere.) See
[timers](/concepts/timers) for more on this.

## Why they are separate from components

A component is always exactly one element. So "state and lifecycle but no markup" — a
common thing to want — has nowhere to live as a component. That is a hook.

(Often you don't even need one: an ordinary component's default element takes up no
space, so a component with a `render()` and a little state is usually fine. Reach for
a hook when you want *no* node at all — for example inside a `<table>` or `<select>`,
where an extra element is illegal — or when you want to share the behaviour itself.)

## What a hook has

Everything a component has, except a `render()` and an element:

- `@state`, `@compute`, `@persist`
- `@create`, `@mount`, `@destroy` (with `env`)
- `@effect`, `@interval`, `@timeout`
- `@onWindow`, `@onDocument` — but **not** `@onElement` (that needs an element)
- `this.use()`, so hooks can use other hooks
- it can provide and read [context](/composition/context)

## The one thing to know

**A hook shares its owner's re-rendering.** When a hook's state changes, the *owner*
component re-renders — the hook has no smaller boundary of its own. That is the one
thing a child component gives you that a hook doesn't. If a hook's state changes a lot
and its owner is expensive to draw, a child component may be the better fit.

## A hook can return markup

A hook has no element, but it can still produce markup for its owner to place — handy
when a group of elements needs shared state but no wrapper (inside a `<tr>`, say):

```tsx
class Toolbar extends Hook<{ actions: Action[] }> {
  @state busy = false;
  buttons() {
    return this.options.actions.map((action) => (
      <button disabled={this.busy} onClick={() => this.run(action)}>{action.label}</button>
    ));
  }
}

// in the owner:
private toolbar = this.use(Toolbar, () => ({ actions: this.actions }));
render() {
  return <div>{this.toolbar.buttons()}</div>;
}
```

For an actual list of data, use [`list()`](/lists) instead — it brings identity,
which a plain `.map()` like this one doesn't.

## Next

- [Writing a hook](/hooks/writing) — options, and keeping them reactive.
