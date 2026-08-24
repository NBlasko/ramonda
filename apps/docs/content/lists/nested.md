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
export class Grid extends Component<{ rows: RowData[] }> {
  private get rows() {
    return this.props.rows;
  }

  render() {
    return (
      <table>
        <tbody>
          {list(this.rows, (row) => (
            <tr>{list(row.cells, (cell) => <td>{cell.value}</td>)}</tr>
          ))}
        </tbody>
      </table>
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
class Row extends Component<{ item: RowData }> {
  render() {
    return <tr>{list(this.props.item.cells, (item) => <CellView item={item} />)}</tr>;
  }
}

export class Grid extends Component<{ rows: RowData[] }> {
  private get rows() {
    return this.props.rows;
  }

  render() {
    return (
      <table>
        <tbody>{list(this.rows, (item) => <Row item={item} />)}</tbody>
      </table>
    );
  }
}
```

## Inside a table, write the element the parent expects

`<table>`, `<tbody>` and `<tr>` accept only certain children, and that is about the
elements you write rather than about components: a component in between is invisible to
the parser, because what it renders is what the parser sees.

So a component used inside a `<tr>` renders cells:

```tsx
class Cells extends Component<{ item: RowData }> {
  render() {
    return [<td>{this.props.item.id}</td>, <td>{this.props.item.cells.length}</td>];
  }
}

const row: RowData = { id: "r1", cells: [] };

<tr>
  <Cells item={row} />
</tr>;
```

Two cells from one component, holding the state behind them, with nothing in between —
which is the case a wrapper element cannot serve at all. An element there is moved out
of the table by the parser and the row falls apart.

## Identity in two dimensions

Same rule as a flat list, at both levels: a row is identified by its row object and
a cell by its cell object. Reorder rows and everything moves with its state.

Replacing rows with fresh objects — an immutable update, a refetch — works the same
way it does for a flat list: each level aligns its own array and carries identity
across. Nothing to declare at either level:

```tsx
@state rows: RowData[] = [];

list(this.rows, (row) => <tr>{list(row.cells, cellView)}</tr>);
```

Editing one row is what makes the two levels visible. The edited row object is
replaced, so it is aligned against the row it replaced; its cells are then aligned
inside it. A cell that only moved keeps its node and its state, and only a cell
that is genuinely new is built.

See [refetched data](/lists#refetched-data-and-objects-that-are-re-created) for
what the alignment does and does not carry.

## Next

- [Conditional and filtered lists](/lists/conditional).
