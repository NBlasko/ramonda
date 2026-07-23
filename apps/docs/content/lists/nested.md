---
title: Nested lists
description: A list of lists nests directly, and what a missing key costs in two dimensions.
section: Lists
order: 62
---

# Nested lists

A grid, a table, a list of groups: an outer list whose items each contain a list.

`list()` is an expression, so it nests where you write it. There is nothing to declare and no
component to introduce:

```tsx
@Host("table")
export class Grid extends Component {
  render() {
    return (
      <tbody>
        {list({
          each: this.rows,
          render: (row) => (
            <tr>{list({ each: row.cells, render: (cell) => <td>{cell.value}</td> })}</tr>
          ),
        })}
      </tbody>
    );
  }
}
```

**Each list has its own key space.** Reordering the outer list moves whole rows, cells intact.
Two lists never share identity, and neither do two `.map()` calls side by side — Ramonda keeps a
nested array as one child rather than splicing it into its parent's children.

## When a row should be a component instead

Nesting directly is right when a row is *markup*. Give the row a component when it is more than
that:

- it owns state, lifecycle, or handlers
- you want it to re-render on its own rather than with the whole grid
- the markup is big enough to deserve a name

```tsx
@Host("tr")
class Row extends Component<{ item: RowData }> {
  render() {
    return list({ each: this.props.item.cells, as: CellView });
  }
}

@Host("table")
export class Grid extends Component {
  render() {
    return <tbody>{list({ each: this.data, as: Row })}</tbody>;
  }
}
```

**`render()` returns the list itself** — no wrapper. `@Host` already supplies the single element,
which is what lets one `@Host("tr")` hold many `<td>`s without a component per cell.

## What no `key` costs in two dimensions

This is the case worth being precise about, because two dimensions is where people reach for keys
out of habit.

Identity is the item object. In a 2D list that means a **row** is identified by its row object,
and a cell by its cell object. So:

| what you do | what happens |
|---|---|
| reorder rows, same objects | rows move with all their cell state — perfect, no key needed |
| replace one row object (an immutable edit) | that row resets; every other row is untouched |
| replace every row object | order is right, all state resets |

**State is never wrong — only reset.** That is the guarantee, and it is stricter than an unkeyed
list matching by index, where state attaches to whichever item now occupies the position.

So `key` in two dimensions is an optimisation and a way to say "this is the same entity", not a
correctness requirement. Reach for it when rows are replaced by fresh objects — a refetch, or an
immutable update — **and** the rows own state you do not want reset:

```tsx
list({
  each: this.rows,
  key: (row) => row.id,
  render: (row) => (
    <tr>{list({ each: row.cells, key: (cell) => cell.id, render: … })}</tr>
  ),
})
```

## Inside a table

`<table>`, `<tbody>` and `<tr>` reject unknown children — the browser's parser moves or deletes
them. So a component inside one must **become the element the parent expects**:

| inside | use |
|---|---|
| `<table>` | `@Host("tbody")` |
| `<tbody>` | `@Host("tr")` |
| `<tr>` | `@Host("td")` |

Development reports the mistake as `RMD010`, naming the parent and suggesting a tag. See
[the host element](/concepts/host).

## Two lists in one component

Perfectly fine, and they do not interfere:

```tsx
render() {
  return (
    <div>
      <ul>{list({ each: this.open, as: TaskRow })}</ul>
      <ul>{list({ each: this.closed, as: TaskRow })}</ul>
    </div>
  );
}
```

A list identifies its region by the component that rendered it plus the child slot it occupies.
That survives a conditional sibling appearing or disappearing next to it; what it does not
survive is being moved to a different slot, which costs one re-render of that list and no
correctness.

## Next

- [Conditional and filtered lists](/lists/conditional) — a list that is a filter, or is not there at all.
