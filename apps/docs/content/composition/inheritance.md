---
title: Extending components
description: The unit of reuse is the class, and classes extend each other — which is why there are no fragments.
section: Composition
order: 70
---

# Extending components

A component that is *almost* another component subclasses it.

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

## What survives the extends

Everything, with no constructor to write:

- **`@Host` is inherited**, and can be overridden. That is the answer to "someone styled a
  `<td>`, I want more behaviour but it must stay a `<td>`."
- **`@state` fields** on the base keep working, and the subclass can add more.
- **Hooks** the base used are still used.
- **Lifecycle** runs base-first, then subclass — `@create` on `Cell` before `@create` on
  `HeaderCell`.
- **Methods** can be overridden, and `super.method()` works.

## Why this matters more here than elsewhere

It is the reason Ramonda needs no fragments.

In a framework whose unit of reuse is a function, functions cannot extend each other — so reuse
means **nesting**. Nesting costs an element, elements distort layout, and a fragment is the
escape hatch that hides the cost.

Classes do not nest to be reused. A component that extends another *is* one component, one
element. There is no wrapper to hide, so there is nothing for a fragment to do.

## The question this usually answers

> Ten `<td>`s, and the first three need special behaviour. I want them wrapped in a component —
> what is a good wrapper?

**None, and that is not a gap.** Write a `Cell` component with `@Host("td")`, and a `SpecialCell`
that extends it. Both are `<td>`s. Nothing wraps anything.

If the group also needs shared state, that is a [hook](/hooks) returning vnodes, spliced in as
`{group.cells()}`.

## `override` is not required

`noImplicitOverride` is not enabled, so `override` is optional. Turn it on in your own tsconfig
if you want a renamed base method to be caught.

## Next

- [Context](/composition/context) — a value without threading it through every level.
