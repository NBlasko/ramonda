import { Component, state, compute, list } from "@ramonda/core";

interface Col {
  key: string;
  label: string;
}
interface Rec {
  id: number;
  vals: Record<string, string>;
}

/**
 * One component, two lists: a header over the columns and a body over a DERIVED
 * grid (rows × visible columns). The body's `each` reads `@compute grid`, which
 * reads the columns — so toggling a column updates BOTH lists from one state
 * change, through the reactive graph rather than by being told twice.
 *
 * The flattening here is a DEMO of the derived-grid shape, not a workaround. It
 * was one back when lists were a hook living in a class field, which could not
 * nest inside a single component; `list()` is an expression and nests freely, so
 * a genuine 2D list needs no component per level any more. TablePage still shows
 * the component-per-level shape, which is what you want when a row owns state.
 */
export class MatrixGrid extends Component {
  @state cols: Col[] = [
    { key: "a", label: "Col A" },
    { key: "b", label: "Col B" },
  ];
  @state recs: Rec[] = [
    { id: 1, vals: { a: "1·A", b: "1·B", c: "1·C" } },
    { id: 2, vals: { a: "2·A", b: "2·B", c: "2·C" } },
  ];

  @compute get grid(): { id: string; value: string }[] {
    const out: { id: string; value: string }[] = [];
    for (const r of this.recs) {
      for (const c of this.cols) {
        out.push({ id: `${r.id}:${c.key}`, value: r.vals[c.key] ?? "—" });
      }
    }
    return out;
  }

  toggleC() {
    const has = this.cols.some((c) => c.key === "c");
    this.cols = has ? this.cols.filter((c) => c.key !== "c") : [...this.cols, { key: "c", label: "Col C" }];
  }

  render() {
    const template = `repeat(${this.cols.length}, 1fr)`;
    return (
      <div className="matrix-wrap">
        <div className="row">
          <h3>Matrix — two lists in one component</h3>
          <button onClick={this.toggleC}>toggle Col C</button>
        </div>
        {/* List #1: column headers */}
        <div className="matrix" style={{ gridTemplateColumns: template }}>
          {list({
            each: this.cols,
            render: (c: Col) => <div className="mcell head">{c.label}</div>,
          })}
        </div>
        {/* List #2: body cells over @compute(rows × cols) */}
        <div className="matrix" style={{ gridTemplateColumns: template }}>
          {list({
            each: this.grid,
            render: (cell: { id: string; value: string }) => <div className="mcell">{cell.value}</div>,
          })}
        </div>
        <p className="muted small">
          Body = {this.grid.length} cells from a second list over a <code>@compute</code> of rows × columns; toggling a
          column updates both lists from one state change.
        </p>
      </div>
    );
  }
}
