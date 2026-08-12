---
title: A component or a function
description: The two ways to turn each item in a list into markup.
section: Rendering lists
order: 41
---

# A component, or a function

`list()`'s second argument is how an item becomes markup. It is either a component or
a function, and nothing has to say which — a class and an arrow are different shapes,
so the framework can tell them apart and so can the types.

## A component — the item has a life of its own

```tsx
list(this.tasks, TaskRow);
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

## A function — the item is plain markup

```tsx
@state tags: { id: string; label: string }[] = [];

list(this.tags, (tag) => <span className="chip">{tag.label}</span>);
```

Use this when an item is just a few tags and a whole component would be overkill. The
result is a plain element — no wrapper appears.

## Which one

| | |
|---|---|
| the item has state, lifecycle, or handlers of its own | a component |
| the item is a few tags | a function |

If the function starts capturing a lot of the surrounding state, that is the sign to
make it a component.

## The position, when you need it

The function takes the item's current index as a second parameter:

```tsx
list(this.tasks, (task, index) => <li>{index + 1}. {task.title}</li>);
```

Declaring it is what asks for it. A row that moves is rebuilt so the number it shows
matches where the row is — which costs a call per moved row, so a function that does
not name the parameter skips untouched rows through a reorder instead.

## Next

- [Nested lists](/lists/nested) — a list of lists.
