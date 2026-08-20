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

And it recomputes **when you read it**, not when the change happens. A `@state`
write marks the compute as stale and goes on; the body runs on the next read. So a
compute nothing reads costs nothing — a value behind a closed panel is not
recalculated while the panel is closed — and the work lands in whoever asks for it
rather than in the write.

```demo:ComputeDemo
```

## It follows what it reads

You never declare what a compute depends on — Ramonda watches what the body actually
reads. In the demo, `total` reads `items`, while `visible` reads `items` **and**
`filter`. So typing in the filter box recomputes `visible` and leaves `total` alone.

This is the fine-grained tracking that [state](/concepts/state) on its own does not
do: changing a `@state` field re-renders the whole component, but a `@compute` only
recalculates when one of *its own* reads changed.

## A getter or a method, and each is read the way it is written

Both work, both cache the same way, and each is typed as what it installs:

```tsx alternatives
@compute
get total() {} // this.total — an accessor, so it IS the value

@compute
total() {} // this.total() — a function that returns the value
```

Use a getter for a value, a method when the name is a verb. Whichever you pick, the
declared type is true: a getter's type is the value's, and a method's is `() => value`.
That is what the `get` decides — how you read it, not whether it is cached.

**Neither takes an argument.** A `@compute` caches one value per component, so there is no
key for an argument to go in: it would be accepted and ignored, and the second call with a
different argument would hand back the first call's answer. So it is refused — by the
framework in every build, and by
[`ramonda-check`](/reference/check) before the build. When the value has to differ per
argument, [`@memoized`](/concepts/caching) is the decorator keyed by them.

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
