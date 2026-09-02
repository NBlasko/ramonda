---
title: compute
description: A value derived from state, cached until something it read changes.
section: Reference
order: 122
---

# `@compute`

A value worked out from other values, cached until one of them moves. Write it as a getter and read
it like a field.

## The situation it is for

A cart that shows a total, a line count and whether free delivery applies. All three come from the
same list, and all three are read more than once per render:

```tsx
interface Line {
  price: number;
  qty: number;
}

class Cart extends Component {
  @state lines: Line[] = [];

  @compute get total(): number {
    return this.lines.reduce((sum, line) => sum + line.price * line.qty, 0);
  }

  @compute get freeDelivery(): boolean {
    return this.total > 50;
  }

  render() {
    return (
      <div>
        <p>{this.lines.length} item(s), {this.total}</p>
        {this.freeDelivery ? <p>Delivery is on us.</p> : <p>Spend {50 - this.total} more.</p>}
      </div>
    );
  }
}
```

Add a line and `total` is worked out **once**, however many times the render reads it — and
`freeDelivery`, which reads `total`, is worked out once too. Change nothing and neither runs at all.

**It follows what it reads.** Nothing declares the dependencies: reading `this.lines` inside `total`
is what ties them, and `freeDelivery` reading `total` chains the two. Add a read and you have added
a tie. See [Compute](/concepts/compute) for the model.

## What it refuses

**Parameters.** A getter cannot take one at all — that is TypeScript, not this framework — so the
shape to watch for is a `@compute` on a METHOD: `@compute priceFor(id: string)`. It is refused, and
the reason is worth knowing rather than just obeying: the cache is keyed by **nothing**, so a second
call with a different argument would hand back the first call's answer, silently. That is what
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
