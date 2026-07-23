---
title: Hooks
description: State, lifecycle and effects with no element of their own — and the one cost that carries.
section: Hooks
order: 50
---

# Hooks

A hook is a class with state, lifecycle and effects, and **no element**.

```tsx
import { Hook, state, interval } from "@ramonda/core";

export class Clock extends Hook {
  @state now = new Date();

  @interval(1000)
  tick() {
    this.now = new Date();
  }
}
```

A component uses it with `this.use()`:

```tsx
export class Header extends Component {
  clock = this.use(Clock);

  render() {
    return <time>{this.clock.now.toLocaleTimeString()}</time>;
  }
}
```

## Why they exist

Because Ramonda is 1-1: every component is exactly one element. So the familiar pattern of "a
component with state and lifecycle but no markup" has nowhere to put itself — the component would
still be an element.

There are two answers, and which one you want depends on whether the element is in your way.

**Usually it is not.** Write an ordinary component and let it have its default host. That host
takes part in no layout, and you keep a re-render boundary of your own.

**Where even an inert element is illegal** — inside `<table>`, `<select>`, `<svg>` — or where you
genuinely want no node at all, that is a hook.

## What a hook has

Everything a component has, except a `render()` and an element:

- `@state`, `@compute`, `@persist`
- `@create`, `@mount`, `@destroy`, with `env`
- `@effect`, `@interval`, `@timeout`
- `@onWindow`, `@onDocument` — but **not** `@onElement`, which needs an element
- `this.use()`, so hooks compose with hooks
- it can provide and consume [context](/concepts/context)

## The one real cost

**A hook shares its owner's runtime.** Its state writes re-render the **owner**, not some smaller
region — it has no re-render boundary of its own.

That is the single thing a stateful component has that a hook does not, and it is worth saying
plainly rather than discovering. If a hook's state changes often and its owner is expensive to
render, a child component is the better shape: the render boundary is the point of the element.

It also means a hook's lifecycle and effects land in the owner's arrays, which is why the
ordering rules read the same for both.

## Hooks can return vnodes

A hook has no element, but nothing stops it producing markup for its owner to place. That is how
a group of elements can share state without a component — and without a wrapper, which matters
inside a `<tr>` or a `<select>` where an extra element is illegal:

```tsx
class Toolbar extends Hook<{ actions: Action[] }> {
  @state busy = false;
  buttons() {
    return this.options.actions.map((action) => (
      <button disabled={this.busy} onClick={() => this.run(action)}>{action.label}</button>
    ));
  }
}

// in the owner
private toolbar = this.use(Toolbar, () => ({ actions: this.actions }));
render() { return <div>{this.toolbar.buttons()}</div>; }
```

The hook contributed N siblings; the component still has exactly one host. For an actual list of
data, reach for [`list()`](/lists) instead — it brings identity with it, which a plain `.map()`
like this one does not.

## Next

- [Writing a hook](/hooks/writing) — options, and how they stay reactive.
