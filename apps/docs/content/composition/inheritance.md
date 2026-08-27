---
title: Extending components
description: When a component is almost another one, build on it instead of copying it.
section: Composition
order: 50
---

# Extending components

When a component is *almost* another one, you don't have to copy it — you can
**extend** it: keep everything it had, and change only what's different.

```tsx
class HeaderCell extends Cell {
  render() {
    return <th>{super.render()}</th>;
  }
}
```

```demo:InheritanceDemo
```

`HeaderCell` is a `Cell` in a `<th>` instead of a `<td>`. `super.render()` calls the
parent's version, so the cell's own markup comes from `Cell` and only the element around
it changes.

## What carries over

Everything, and you don't write a constructor:

- **`@state` fields** on the parent keep working; the subclass can add more.
- **Hooks** the parent used are still used.
- **Lifecycle callbacks** belong to the class that declares them, and each one runs
  **once per instance** — extending a class does not make its `@created` run a second
  time, however long the chain is. When a parent and a child each declare one, both
  run, the parent's first.
- **Methods** can be overridden, and `super.method()` calls the original.

## A common question

> Ten `<td>`s, and the first three need special behaviour. What component do I wrap
> them in?

None — and that isn't a gap. Write a `Cell` that renders a `<td>`, and a `SpecialCell`
that extends it. Both are `<td>`s; nothing wraps anything.

And if the special three want one shared state between them, that is a component too: a
component may return several cells at once, so `<SpecialCells />` inside the row is three
`<td>`s and one place to keep what they share.

## `override` is optional

Ramonda doesn't require the `override` keyword. Turn on `noImplicitOverride` in your
own tsconfig if you'd like a renamed parent method to be flagged.

## Next

- [Context](/composition/context) — a value shared down a subtree.
