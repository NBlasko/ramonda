---
title: compute
description: A value derived from state, cached until something it read changes.
section: Reference
order: 122
---

# `@compute`

A value worked out from other values, cached until one of them moves. Write it as a getter and read
it like a field.

```tsx
class Cart extends Component {
  @state items: number[] = [];

  @compute get total(): number {
    return this.items.reduce((sum, n) => sum + n, 0);
  }

  render() {
    return <p>{this.total}</p>;
  }
}
```

**It follows what it reads.** Nothing declares the dependencies: reading `this.items` inside is what
ties the two together, and adding a second read adds a second tie. See
[Compute](/concepts/compute) for the model.

## What it refuses

**Parameters.** `@compute get user(id: string)` is refused, and it is worth knowing why rather than
just obeying: the cache is keyed by **nothing**, so a second call with a different argument would
hand back the first call's answer, silently. That is what
[`@memoized`](/reference/decorators/memoized) is for — it keys the cache by the arguments.

`ramonda-check` refuses it before anything runs, as
[`compute-takes-no-arguments`](/rules/compute-takes-no-arguments), and that rule **fails the build**.

**Anything but a getter or a method.** A field is not derived.

**Changing something.** A compute reads; it does not write. A state write inside one is reported as
[`RMD018`](/reference/diagnostics/rmd018), for the same reason as a write during a render.

## What it costs, and when not to reach for it

The cache is per instance and holds one value. It recomputes when something it read changes and not
otherwise, so the cost of reading it twice in one render is one read.

Two things it is not:

- **A place to do work.** A fetch, a timer, a subscription — those belong in
  [`@created`](/reference/decorators/created) or a [hook](/hooks).
- **A cache with arguments.** That is [`@memoized`](/reference/decorators/memoized).

## Next

- [Compute](/concepts/compute) — the model, and when to reach for it.
- [`@memoized`](/reference/decorators/memoized) — the same idea, keyed by arguments.
- [Caching](/concepts/caching) — which of the two a case wants.
