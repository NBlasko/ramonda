---
title: The row callback
description: How each item in a list becomes markup, and where the key goes.
section: Rendering lists
order: 41
---

# The row callback

`list()`'s second argument turns one item into one element. It takes the item, and
nothing else:

```tsx
list(this.tags, (tag) => <span className="chip">{tag.label}</span>);
```

One item, one element. That element is what carries the row's `key` and what the diff
matches rows on, so a callback that returns a string, a number, or another `list()`
is reported ([`RMD031`](/reference/diagnostics)) — wrap it in an element instead.

## When the row is a component

Give the component the item as a prop, and put the key on it:

```tsx
list(this.tasks, (task) => <TaskRow key={task.id} item={task} />);
```

```tsx
@Host("li")
class TaskRow extends Component<{ item: Task }> {
  render() {
    return <span>{this.props.item.title}</span>;
  }
}
```

A shorthand that took the component directly — `list(this.tasks, TaskRow)` — used to
exist. It read well and left nowhere to put a key, since the element is built by the
component rather than by you, so it was the one form that could not say which row is
which. One form now, and it is the one that can express everything.

## There is no index

The callback is handed the item alone. That is deliberate, and it closes two doors at
once.

A row that shows its position has to be rebuilt whenever it moves, so a single insert
at the top re-renders every row below it — the cost lands on lists that never mention
the position as much as on the one that does.

And an index must never become a row's identity. It follows the *position*, so keying
by it says "this is the second row", which is the one thing that is guaranteed to be
wrong the moment rows move.

When a row genuinely needs to know where it sits, work it out where the data is built
rather than where it is rendered:

```tsx
@compute
private get numbered() {
  return this.tasks.map((task, at) => ({ task, position: at + 1 }));
}

render() {
  return <ol>{list(this.numbered, (row) => <li key={row.task.id}>{row.position}. {row.task.title}</li>)}</ol>;
}
```

## Which one to reach for

| | |
|---|---|
| the item has state, lifecycle, or handlers of its own | a component |
| the item is a few tags | plain markup in the callback |

If the callback starts capturing a lot of the surrounding state, that is the sign to
make it a component.

## Next

- [Nested lists](/lists/nested) — a list of lists.
