import { Component, state, Host, list } from "@ramonda/core";
import { MatrixGrid } from "../demos/MatrixGrid";
import { TwoLists } from "../demos/TwoLists";

interface Cell {
  value: string;
}
interface RowData {
  label: string;
  cells: Cell[];
}

let nextRowId = 3;
function makeRow(label: string): RowData {
  // Fresh cell objects → the list gives each its own identity, no keys written.
  return {
    label,
    cells: [{ value: `${label}·1` }, { value: `${label}·2` }, { value: `${label}·3` }],
  };
}

/**
 * One component per row, owning a list over its own cells. It IS the <tr>
 * (@Host), so it drops <td>s straight into the table — no wrapper.
 *
 * A component per level is no longer forced — `list()` nests inside one
 * component perfectly well. It is still the right shape HERE, because a row that
 * owns state needs somewhere to keep it, and that somewhere is a component.
 */
@Host("tr")
export class TableRow extends Component<{ item: RowData }> {
  render() {
    // This component is a <tr>; render() may return an array of children, and a
    // list is one of them — the host supplies the single element, so 1-1 holds.
    //
    // The inner list uses `render` because a cell maps to plain <td> markup
    // rather than a component — that is the case `render` is for.
    return [
      <td className="rowlabel">{this.props.item.label}</td>,
      list({
        each: this.props.item.cells,
        render: (cell: Cell) => <td>{cell.value}</td>,
      }),
    ];
  }
}

export class TablePage extends Component {
  // Two seeded rows; identity is the RowData object itself.
  @state rows: RowData[] = [makeRow("A"), makeRow("B")];

  addRow() {
    this.rows = [...this.rows, makeRow(String.fromCharCode(64 + ++nextRowId))];
  }
  prependRow() {
    this.rows = [makeRow(String.fromCharCode(64 + ++nextRowId)), ...this.rows];
  }
  removeFirst() {
    this.rows = this.rows.slice(1);
  }
  shuffle() {
    this.rows = [...this.rows].reverse();
  }

  render() {
    return (
      <div className="page">
        <h2>Two lists → a table</h2>
        <p className="muted">
          Outer <code>list()</code> over rows, each row's inner one over its cells. No <code>key</code> anywhere —
          identity is the row/cell object itself. Reorder or prepend and every row keeps its own DOM node; open devtools
          COMPONENTS to watch.
        </p>
        <div className="row">
          <button onClick={this.addRow}>append row</button>
          <button onClick={this.prependRow}>prepend row</button>
          <button onClick={this.removeFirst}>remove first</button>
          <button onClick={this.shuffle}>reverse</button>
        </div>
        <table className="grid-table">
          <thead>
            <tr>
              <th>row</th>
              <th>col 1</th>
              <th>col 2</th>
              <th>col 3</th>
            </tr>
          </thead>
          {/* `as` means no per-item function at all — the list builds
              <TableRow item={row} /> itself. */}
          <tbody>{list({ each: this.rows, as: TableRow })}</tbody>
        </table>

        <TwoLists />
        <MatrixGrid />
      </div>
    );
  }
}
