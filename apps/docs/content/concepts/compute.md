---
title: Derived values
description: A value computed from your state that recalculates itself only when it needs to.
section: Lifecycle and subscriptions
order: 32
---

# Derived values

Often a value you want to show is *computed* from your state — a total from a list of
prices, a filtered view of some items. `@compute` gives you exactly that: a value
derived from state that recalculates itself only when it needs to.

```tsx
export class Cart extends Component {
  @state items: Item[] = [];

  @compute
  get total() {
    return this.items.reduce((sum, item) => sum + item.price, 0);
  }
}
```

Read it like a field — `this.total`. It recomputes only when something it read has
changed; the rest of the time you get the cached value back.

```demo:ComputeDemo
```

## It follows what it reads

You never declare what a compute depends on — Ramonda watches what the body actually
reads. In the demo, `total` reads `items`, while `visible` reads `items` **and**
`filter`. So typing in the filter box recomputes `visible` and leaves `total` alone.

This is the fine-grained tracking that [state](/concepts/state) on its own does not
do: changing a `@state` field re-renders the whole component, but a `@compute` only
recalculates when one of *its own* reads changed.

## A getter or a method

Both work, and both cache the same way:

```tsx
@compute
get total() {} // this.total

@compute
total() {} // this.total()
```

Use a getter for a value, a method when the name is a verb.

## It must not change anything

A compute *derives* a value and returns it — it must not write state or cause side
effects. Ramonda calls it whenever something reads it, on no schedule you control, so
a write in there is a bug: it is reported as
[RMD018](/reference/diagnostics). (To count a compute's runs for yourself, use a
plain field rather than `@state`, as the demo does.)

## When to reach for it

Use `@compute` when the work is real — a filter or reduce over a list, a sort, a
parse — or when several places read the same derived value in one render. For
something cheap like a string join or a `.length`, just write it in `render()`: it
recomputes each render, which is exactly as often as it is needed.

## Next

- [Subscriptions](/concepts/subscriptions) — for work that is *not* a value.
