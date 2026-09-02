---
title: ShouldUpdateOnPropsChange
description: The rule a component follows when its parent hands it new props — an escape hatch, with a cost worth reading first.
section: Reference
order: 132
---

# `@ShouldUpdateOnPropsChange`

A class decorator carrying the rule a component follows when its parent hands it new props: return
`true` to take them, `false` to ignore the update.

```tsx
@ShouldUpdateOnPropsChange((self, previous: { id: number }, next: { id: number }) => previous.id !== next.id)
class Row extends Component<{ id: number; noisy: unknown }> {
  render() {
    return <li>{this.props.id}</li>;
  }
}
```

## Read this before reaching for it

**Refusing an update leaves the props stale for this component's own later renders too.** Nothing
re-reads them until the parent sends another update — so a re-render caused by this component's own
`@state` still shows the props it last *accepted*, not the ones it was last handed.

That is the trade, and it is why this is an escape hatch rather than an optimisation to sprinkle.
Reach for [`@StableProps`](/reference/decorators/StableProps) first: it names values instead of
writing a rule, so the worst a mistake can do is fail to type-check rather than freeze a component.

## Why a class decorator

It was a method decorator once, and moving it fixed two faults this shape cannot have:

- **A subclass overriding the decorated method** without re-decorating ran the *base's* body,
  because the function was captured at decoration time. There is no method to capture now.
- **Declaring it at both levels** — the ordinary way to override a rule — was reported as a
  duplicate, because nothing recorded which class had declared it. The answer lives on the
  constructor now, so "declared here" and "inherited" are told apart exactly.

## What it refuses

**Anything but a function.** It throws where it is written, naming what was passed.

## What it costs

Your predicate runs on every props update, and everything it does not compare is a change this
component will not see. That is the direction that hurts: a component which stops rendering when it
should is a bug that looks like nothing at all.

## Next

- [`@StableProps`](/reference/decorators/StableProps) — names instead of a rule, and the first thing
  to try.
- [Props](/concepts/props) — how an update reaches a component.
- [The reactivity model](/why/reactivity) — what re-renders, and why.
