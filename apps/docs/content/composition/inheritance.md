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
@Host("th")
class HeaderCell extends Cell {
  render() {
    return <strong>{super.render()}</strong>;
  }
}
```

```demo:InheritanceDemo
```

`HeaderCell` is a `Cell` that renders in bold and is a `<th>` instead of a `<td>`.
`super.render()` calls the parent's version.

## What carries over

Everything, and you don't write a constructor:

- **`@Host`** is inherited and can be overridden — so "keep it a `<td>` but add
  behaviour" is just extending `Cell`.
- **`@state` fields** on the parent keep working; the subclass can add more.
- **Hooks** the parent used are still used.
- **Lifecycle** runs parent-first, then subclass — the parent's `@create` before the
  child's.
- **Methods** can be overridden, and `super.method()` calls the original.

## A common question

> Ten `<td>`s, and the first three need special behaviour. What component do I wrap
> them in?

None — and that isn't a gap. Write a `Cell` with `@Host("td")`, and a `SpecialCell`
that extends it. Both are `<td>`s; nothing wraps anything. (If the special group also
needs shared state, that's a [hook](/hooks) that returns the cells.)

## `override` is optional

Ramonda doesn't require the `override` keyword. Turn on `noImplicitOverride` in your
own tsconfig if you'd like a renamed parent method to be flagged.

## Next

- [Context](/composition/context) — a value shared down a subtree.
