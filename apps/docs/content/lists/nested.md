---
title: Nested lists
description: A list of lists — a grid or table — nests wherever you write it.
section: Lists
order: 62
---

# Nested lists

A grid, a table, a list of groups — an outer list whose items each contain a list.
Because `list()` is just an expression, it nests wherever you write it:

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

Each list keeps its own identity, so reordering the outer list moves whole rows with
their cells intact, and two lists never get their items confused — even side by side.

## When a row should be a component

Nesting inline is right when a row is just markup. Make the row a component when it is
more — it owns state, you want it to re-render on its own, or the markup deserves a
name:

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

`render()` returns the list directly — `@Host("tr")` already supplies the one
element, which is what lets a row hold many cells with no component per cell.

## Inside a table, become the right element

`<table>`, `<tbody>` and `<tr>` only accept certain children, so a component inside
one must be the element the parent expects:

| inside | use |
|---|---|
| `<table>` | `@Host("tbody")` |
| `<tbody>` | `@Host("tr")` |
| `<tr>` | `@Host("td")` |

Development reports a mismatch as `RMD010`. See [the host element](/concepts/host).

## Keys in two dimensions

Same rule as a flat list: identity is the object, so a row is identified by its row
object and a cell by its cell object. Reorder rows (same objects) and everything moves
with its state — no key needed. You only need a `key` when rows are *replaced* by
fresh objects (a refetch, an immutable update) **and** they own state you don't want
reset:

```tsx
list({
  each: this.rows,
  key: (row) => row.id,
  render: (row) => <tr>{list({ each: row.cells, key: (cell) => cell.id, render: cellView })}</tr>,
});
```

## Next

- [Conditional and filtered lists](/lists/conditional).
