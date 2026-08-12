---
title: Nested lists
description: A list of lists — a grid or table — nests wherever you write it.
section: Rendering lists
order: 42
---

# Nested lists

A grid, a table, a list of groups — an outer list whose items each contain a list.
Because `list()` is just an expression, it nests wherever you write it:

```tsx
@Host("table")
export class Grid extends Component<{ rows: RowData[] }> {
  private get rows() {
    return this.props.rows;
  }

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
export class Grid extends Component<{ rows: RowData[] }> {
  private get rows() {
    return this.props.rows;
  }

  render() {
    return <tbody>{list({ each: this.rows, as: Row })}</tbody>;
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

## Identity in two dimensions

Same rule as a flat list, at both levels: a row is identified by its row object and
a cell by its cell object. Reorder rows and everything moves with its state.

Replacing rows with fresh objects — an immutable update, a refetch — works the same
way it does for a flat list: each level aligns its own array and carries identity
across. Nothing to declare at either level:

```tsx
@state rows: RowData[] = [];

list({
  each: this.rows,
  render: (row) => <tr>{list({ each: row.cells, render: cellView })}</tr>,
});
```

Editing one row is what makes the two levels visible. The edited row object is
replaced, so it is aligned against the row it replaced; its cells are then aligned
inside it. A cell that only moved keeps its node and its state, and only a cell
that is genuinely new is built.

See [refetched data](/lists#refetched-data-and-objects-that-are-re-created) for
what the alignment does and does not carry.

## Next

- [Conditional and filtered lists](/lists/conditional).
