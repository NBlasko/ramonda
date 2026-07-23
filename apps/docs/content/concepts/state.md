---
title: State
description: How @state turns a class field into a signal, what tracking means, and when the DOM catches up.
section: Core concepts
order: 32
---

# State

`@state` turns a class field into a signal.

```tsx
export class Counter extends Component {
  @state count = 0;
}
```

Reading it inside `render()` subscribes this component to it. Assigning to it schedules a
re-render. There is no setter and no dependency list.

```demo:Counter
```

## What tracking actually means

The subscription is per **field**, established by the read. A component that never reads
`this.expanded` does not re-render when `expanded` changes, even though the field is on the same
instance.

That has a practical consequence worth knowing: what re-renders is decided by your `render()`,
not by where the write came from. Moving a read out of `render()` and into an event handler
removes the subscription.

## Assignment is the update

```tsx
this.count = this.count + 1;   // ✓
this.items = [...this.items, next];  // ✓
```

**Mutating in place is not.** The signal compares values, and an array you pushed into is the
same array.

```tsx
this.items.push(next);   // ✗ nothing re-renders
```

In development this is reported as `RMD005`. In production it is simply silent, which is why the
diagnostic exists.

The same applies to objects: replace, do not mutate.

```tsx
this.user = { ...this.user, name };   // ✓
```

## Do not write state during a render

`render()` must be a function of state, not a place that changes it. A write during a render
schedules another render from inside the render that caused it.

```tsx
render() {
  this.seen = true;     // ✗ RMD001
  return <p>…</p>;
}
```

Put it in [`@create`](/concepts/lifecycle) if it is initialisation, or in an event handler if it
is a response to something.

## Batching, and when the DOM catches up

Writes are batched through a microtask. Several assignments in one turn produce **one** render.

```tsx
this.a = 1;
this.b = 2;
this.c = 3;
// one render
```

The DOM is therefore one microtask behind the assignment. In an app that is invisible and
desirable. It shows up in exactly one place:

### Testing a change

```ts
import { render, act } from "@ramonda/testing-library";

const { instance, getByText } = render<Counter>(<Counter />);

act(() => { instance.count = 5; });
expect(getByText("count is 5")).toBeTruthy();
```

`act` runs the callback and then commits everything it caused — every pending render, `@mount`
and effect — however deep the cascade goes. Without it the assertion reads the DOM as it was
before the write.

Note `instance`: because state is a field on an object, a test can set it directly rather than
having to find an event that would. Both are worth testing; this one is for setting up a state
that would take six clicks to reach.

## After a component is gone

Writing to a destroyed component's state is dropped, not applied — a fetch that resolves after
the user navigated away cannot schedule a render into a detached tree. In development it is
reported as `RMD008`. The drop ships in production too.

## Values that are not signals

Not every field needs to be one. A plain field is fine for anything a render never reads.

`@persist` marks a plain field as part of the hydration payload without making it reactive —
for set-once, render-relevant values on a prerendered page. See [server rendering](/guide/examples).

## Next

- [Props](/concepts/props) — state that belongs to the parent.
- [Lifecycle](/concepts/lifecycle) — where initialisation goes.
