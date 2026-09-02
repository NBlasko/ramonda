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

## Extending or wrapping

Both are available and neither adds an element: a component puts on the page exactly what its
`render()` returns, so a wrapper that hands back `this.props.children` contributes nothing of its
own. The choice is about **what you are reusing**, not about what it costs.

**Extend when you are reusing a component's own markup and behaviour** and changing part of it.
`super.render()` is the thing a wrapper cannot do — it gives you the parent's output to build on,
along with its state, its hooks and its lifecycle, with no props to thread through.

**Wrap when you are adding something around children you do not own.** A wrapper takes anything;
a subclass is tied to one parent. A scope for a context, a boundary, a layout that must work over
markup it has never seen — those are wrappers, and `Context` and `Portal` are both built that way.

The question that used to have only one answer:

> Ten `<td>`s, and the first three need special behaviour.

Write a `Cell` that renders a `<td>` and a `SpecialCell` that extends it — the special behaviour
*is* a cell's behaviour, so it belongs on a cell. And if those three want one shared state between
them, that is a component too: a component may return several cells at once, so `<SpecialCells />`
inside the row is three `<td>`s and one place to keep what they share.

## `override` is optional

Ramonda doesn't require the `override` keyword. Turn on `noImplicitOverride` in your
own tsconfig if you'd like a renamed parent method to be flagged.

## Next

- [Context](/composition/context) — a value shared down a subtree.
