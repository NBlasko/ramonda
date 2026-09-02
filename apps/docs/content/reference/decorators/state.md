---
title: state
description: Marks a field as reactive — read it in a render and the component re-renders when it is assigned.
section: Reference
order: 134
---

# `@state`

Marks a field as **reactive**. Read it while rendering and the component renders again whenever it
is assigned.

```tsx
class Counter extends Component {
  @state count = 0;

  add() {
    this.count++;
  }

  render() {
    return <button onclick={this.add}>{this.count}</button>;
  }
}
```

There is no setter and no separate place for state to live. It is a field: read it with
`this.count`, change it with `this.count = 5`.

See [State](/concepts/state) for the reactivity model this is the front door to.

## Assignment is what fires

A signal fires when it is **assigned**, not when the value it holds changes inside. So this does
nothing:

```tsx expect-report:state-mutated-in-place
this.items.push(next);
```

and this does:

```tsx
this.items = [...this.items, next];
```

Mutating in place is reported both ways — as [`RMD005`](/reference/diagnostics/rmd005) when it runs,
and by `ramonda-check` as [`state-mutated-in-place`](/rules/state-mutated-in-place) before it does.

## What it refuses

**Anything but a field.** A getter that derives is [`@compute`](/reference/decorators/compute); a
method is not state.

**A write during a render.** `render()` reads state; it does not write it. A write there schedules
another render from inside a render, and is reported as
[`RMD001`](/reference/diagnostics/rmd001) — with
[`state-written-while-rendering`](/rules/state-written-while-rendering) finding it in the source,
including through a helper the render calls three files away.

## What it costs

One signal per field, and a comparison on assignment: writing the value it already holds re-renders
nothing.

**It is part of the hydration blob.** A `@state` field is serialised so the browser resumes with the
value the server had — which is why [`@persist`](/reference/decorators/persist) beside it adds
nothing and is reported as [`RMD046`](/reference/diagnostics/rmd046). A value that cannot be
serialised is reported as [`unserializable-state`](/rules/unserializable-state).

## Next

- [State](/concepts/state) — the model, and what a signal compares.
- [`@compute`](/reference/decorators/compute) — a value derived from state, cached.
- [`@persist`](/reference/decorators/persist) — for the fields `@state` does not cover.
