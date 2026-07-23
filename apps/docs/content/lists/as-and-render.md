---
title: as and render
description: Two ways to turn an item into markup, and why `as` avoids a per-item closure.
section: Lists
order: 61
---

# `as` and `render`

`list()` takes exactly one of them.

## `as` — the item is a component

```tsx
list({ each: this.tasks, as: TaskRow })
```

It builds `<TaskRow item={task} />` for each item. The component receives the item as its
`item` prop:

```tsx
@Host("li")
class TaskRow extends Component<{ item: Task }> {
  render() {
    return <span>{this.props.item.title}</span>;
  }
}
```

**There is no per-item function in your code.** Nothing to memoize, nothing that gets recreated
on every render, nothing for a lint rule to flag.

## `render` — the item is plain markup

```tsx
list({
  each: this.tags,
  render: (tag) => <span className="chip">{tag.label}</span>,
})
```

Use it when an item maps to bare markup and a whole component would be ceremony. The result is a
plain element — no `<ramonda-host>` wrapper appears.

## Which

| | |
|---|---|
| the item has state, lifecycle, or handlers of its own | `as` |
| the item is a few tags | `render` |

If you find yourself writing a `render` closure that captures a lot of the owner's state, that is
usually the signal to make it a component and switch to `as`.

## One or the other, never both

The types forbid passing both, and forbid passing neither. At runtime the same mistake is
reported as `RMD014` — for the case where the build has no types.

## What `as` does not do

It does not reduce the number of render **calls**. A fresh vnode is still built per item when
the owner re-renders; `as` removes the closure, not the work.

Reducing the calls is a different mechanism — per-item reactive scopes, so an item whose data did
not change is not re-rendered at all. That machinery is always on, and it is what makes a large
list cost work proportional to what changed rather than to its length.

## Next

- [Nested lists](/lists/nested) — a list of lists, and matrices.
