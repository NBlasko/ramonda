---
title: as and render
description: The two ways to turn each item in a list into markup.
section: Rendering lists
order: 41
---

# `as` and `render`

`list()` needs to know how to turn each item into markup. You give it exactly one of
two options.

## `as` — the item is a component

```tsx
list({ each: this.tasks, as: TaskRow });
```

Ramonda builds `<TaskRow item={task} />` for each item; the component reads it from
`this.props.item`:

```tsx
@Host("li")
class TaskRow extends Component<{ item: Task }> {
  render() {
    return <span>{this.props.item.title}</span>;
  }
}
```

There is no per-item function in your code — nothing that gets recreated on every
render.

## `render` — the item is plain markup

```tsx
list({
  each: this.tags,
  render: (tag) => <span className="chip">{tag.label}</span>,
});
```

Use this when an item is just a few tags and a whole component would be overkill. The
result is a plain element — no wrapper appears.

## Which one

| | |
|---|---|
| the item has state, lifecycle, or handlers of its own | `as` |
| the item is a few tags | `render` |

If a `render` closure starts capturing a lot of the surrounding state, that is the
sign to make it a component and switch to `as`.

## One or the other, never both

Passing both, or neither, is a type error — and at runtime, where there are no types,
it is reported as `RMD014`.

## Next

- [Nested lists](/lists/nested) — a list of lists.
