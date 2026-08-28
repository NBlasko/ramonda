import { Component, state, list } from "@ramonda/core";
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
 * One component per row, owning a list over its own cells.
 *
 * It writes its own `<tr>`, and the cells go straight inside it. A component per level is not
 * forced — `list()` nests inside one component perfectly well — but it is the right shape HERE,
 * because a row that owns state needs somewhere to keep it, and that somewhere is a component.
 */
export class TableRow extends Component<{ item: RowData }> {
  render() {
    // The inner list uses `render` because a cell maps to plain `<td>` markup rather than a
    // component — that is the case `render` is for.
    return (
      <tr>
        <td className="rowlabel">{this.props.item.label}</td>
        {list(this.props.item.cells, (cell: Cell) => (
          <td>{cell.value}</td>
        ))}
      </tr>
    );
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
          <button onclick={this.addRow}>append row</button>
          <button onclick={this.prependRow}>prepend row</button>
          <button onclick={this.removeFirst}>remove first</button>
          <button onclick={this.shuffle}>reverse</button>
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
          <tbody>
            {list(this.rows, (item) => (
              <TableRow item={item} />
            ))}
          </tbody>
        </table>

        <TwoLists />
        <MatrixGrid />
      </div>
    );
  }
}
