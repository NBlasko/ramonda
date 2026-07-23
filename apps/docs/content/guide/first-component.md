---
title: Your first component
description: Write a Ramonda component, give it state, and handle an event.
section: Guide
order: 11
---

# Your first component

A component is a class. It extends `Component` and it has a `render()`.

```tsx
import { Component } from "@ramonda/core";

export class Hello extends Component {
  render() {
    return <p>Hello.</p>;
  }
}
```

Mount it:

```tsx
import { bootstrap } from "@ramonda/core";

bootstrap(<Hello />, document.getElementById("app")!);
```

That is the whole setup. There is no provider to wrap it in and no root API to configure.

## Add state

A field marked `@state` is a signal. Reading it inside `render()` subscribes; assigning to it
schedules a re-render.

```tsx
import { Component, state } from "@ramonda/core";

export class Counter extends Component {
  @state count = 0;

  increment() {
    this.count = this.count + 1;
  }

  render() {
    return <button onClick={this.increment}>count is {this.count}</button>;
  }
}
```

```demo:Counter
```

Three things in that example are worth naming, because each is a decision the framework made
for you.

**There is no setter.** `this.count = this.count + 1` is the update. `@state` replaces the
field with an accessor, so an ordinary assignment is what the framework observes.

**`onClick={this.increment}` works.** Ramonda binds your methods to the instance when the
component is constructed, so passing one as a handler does not lose `this`. You do not need a
constructor, and you do not need arrow-function fields — which matters, because a decorator
cannot be applied to an arrow field.

**Nothing declares a dependency.** `render()` read `this.count`, so this component re-renders
when `count` changes and not otherwise. There is no dependency array to keep in step with the
body.

## What happens when you assign

Assigning does not touch the DOM immediately. Ramonda batches: several writes in one turn
produce one render, on the next microtask.

```tsx
this.count = 1;
this.count = 2;
this.count = 3;
// one render, with count === 3
```

That is invisible in an app and matters in exactly one place — a test that asserts straight
after a write reads the old DOM. See [testing](/guide/state#testing-a-change) on that page, or
`act()` in `@ramonda/testing-library`.

## Next

- [Components](/concepts/components) — the one rule the whole framework is built on.
- [State](/concepts/state) — what a signal tracks, and what it does not.
