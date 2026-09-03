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
is reported ([`RMD031`](/reference/diagnostics/rmd031)) — wrap it in an element instead.

## When the row is a component

Give the component the item as a prop:

```tsx
list(this.tasks, (task) => <TaskRow item={task} />);
```

If the rows are replaced by fresh objects and you want a key, it goes on the component — not on a
tag inside it, which the row's own render owns and you cannot reach:

```tsx
list(this.tasks, (task) => <TaskRow key={task.id} item={task} />);
```

```tsx
class TaskRow extends Component<{ item: Task }> {
  render() {
    return (
      <li>
        <span>{this.props.item.title}</span>
      </li>
    );
  }
}
```

The callback is where the key goes, and that is why `list()` always takes one. Hand it
a component and the element would be built inside that component, out of your reach —
leaving nothing to say which row is which.

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
class NumberedTasks extends Component {
  @state tasks: Task[] = [];

  @compute
  private get numbered() {
    return this.tasks.map((task, at) => ({ task, position: at + 1 }));
  }

  render() {
    return <ol>{list(this.numbered, (row) => <li key={row.task.id}>{row.position}. {row.task.title}</li>)}</ol>;
  }
}
```

## Which one to reach for

| | |
|---|---|
| the item has state, lifecycle, or handlers of its own | a component |
| the item is a few tags | plain markup in the callback |

If the callback starts capturing a lot of the surrounding state, that is the sign to
make it a component.

Whichever you pick, read the state a row shows *inside* the callback and keep it `@state`. A value read
outside, or a plain field, is not recorded against the row — see
[what a row is allowed to remember](/lists#skipping-the-callback-needs-a-callback-it-can-skip).

## Next

- [Nested lists](/lists/nested) — a list of lists.
