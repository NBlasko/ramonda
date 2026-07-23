---
title: Derived values
description: "@compute caches a value derived from state and recomputes it only when a read changed."
section: Core concepts
order: 36
---

# Derived values

`@compute` caches a value derived from state.

```tsx
export class Cart extends Component {
  @state items: Item[] = [];

  @compute
  get total() {
    return this.items.reduce((sum, item) => sum + item.price, 0);
  }
}
```

Read it like a field: `this.total`. It recomputes only when something it read has changed.

```demo:ComputeDemo
```

## It tracks reads, not declarations

The dependencies are whatever the body actually read, this time. Nothing is declared, and there
is no array to keep in step.

In the demo above, `total` reads `items` and `visible` reads `items` **and** `filter`. So typing
in the filter box recomputes `visible` and leaves `total` alone — you can watch the two counters
diverge.

That also means a conditional branch changes the dependencies. A compute that returns early
before reading `this.expensive` is not subscribed to `expensive` that time round, and will be
once the branch changes.

## Method or getter

Both work, and both are cached the same way:

```tsx
@compute
get total() { … }   // this.total

@compute
total() { … }       // this.total()
```

Pick whichever reads better where it is used. A getter is usually right for a value; a method
reads better when the name is a verb.

## Computes may read computes

A `@compute` that reads another one subscribes to what the inner one depends on, not just to the
inner one. So a cache *hit* on the inner value still registers the right dependencies, and the
outer value cannot go stale.

```tsx
@compute
get subtotal() { return sum(this.items); }

@compute
get withTax() { return this.subtotal * 1.2; }
```

## When not to reach for it

`@compute` costs a cache, a dependency set and a subscription per instance. For something cheap
— a string concatenation, a comparison, a `.length` — just write it in `render()`. It will be
recomputed on every render of that component, which is precisely as often as it is needed.

Reach for `@compute` when the work is real (a filter or a reduce over a list, a sort, a parse) or
when the value is read from several places in one render.

## It must be pure

The framework calls it when something reads it, which is not a schedule you control. A `@compute`
derives a value and returns it — it does not write state, and does not perform side effects.

Writing reactive state while deriving is reported as [RMD018](/reference/diagnostics#rmd018-state-written-during-a-compute), and the reason is not
style: if the compute reads the signal it wrote, it invalidates its own cache and recomputes
forever; if it reads another, every read now fires that signal's listeners and re-renders whatever
was only trying to read a derived value.

The demo counts its own runs with a **plain field** — `totalRuns = 0`, not `@state` — bumped
inside the getter. That is the sanctioned way to instrument a compute: render re-runs on the same
changes the compute does, so it always reads the latest count, and nothing reactive is written.

## Next

- [Effects](/concepts/effects) — for the work that is *not* a value.
