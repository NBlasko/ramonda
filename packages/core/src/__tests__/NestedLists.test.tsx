import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, list, state } from "../index";

/**
 * The playground's /table page, reduced: a list of rows in a <tbody> where each
 * row is a component owning a list over its own cells, followed by two sibling
 * components that each own another list.
 *
 * Four lists across three components, all minting f0/f1, three of them ending up
 * under the same page <div>. If regions ever stop being scoped, this is the
 * shape that shows it — and it is the shape a real page actually has.
 */

interface Cell {
  value: string;
}
interface RowData {
  label: string;
  cells: Cell[];
}
const makeRow = (l: string): RowData => ({
  label: l,
  cells: [{ value: `${l}1` }, { value: `${l}2` }],
});

class TableRow extends Component<{ item: RowData }> {
  render() {
    return (
      <tr>
        {[
          <td className="rowlabel">{this.props.item.label}</td>,
          list(this.props.item.cells, (c: Cell) => <td>{c.value}</td>),
        ]}
      </tr>
    );
  }
}

class TwoLists extends Component {
  @state todo = [{ title: "a" }, { title: "b" }];
  render() {
    return (
      <div className="twocol">
        <ul className="tasks">
          {list(this.todo, (t: { title: string }) => (
            <li className="task">{t.title}</li>
          ))}
        </ul>
      </div>
    );
  }
}

class MatrixGrid extends Component {
  @state cols = [{ label: "A" }, { label: "B" }];
  render() {
    return (
      <div className="matrix-wrap">
        <div className="matrix">
          {list(this.cols, (c: { label: string }) => (
            <div className="mcell head">{c.label}</div>
          ))}
        </div>
      </div>
    );
  }
}

class TablePage extends Component {
  @state rows: RowData[] = [makeRow("A"), makeRow("B")];
  prependRow() {
    this.rows = [makeRow("Z"), ...this.rows];
  }
  render() {
    return (
      <div className="page">
        <h2>Table</h2>
        <div className="row">
          <button onclick={this.prependRow}>prepend</button>
        </div>
        <table className="grid-table">
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

describe("playground /table page shape", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("siblings after a table containing a list all render", async () => {
    const app = await getDOM<TablePage>(<TablePage />);
    await app.settle();

    expect(app.container.querySelectorAll("tbody tr").length).toBe(2);
    expect(app.container.querySelector(".twocol")).toBeTruthy();
    expect(app.container.querySelectorAll(".task").length).toBe(2);
    expect(app.container.querySelector(".matrix-wrap")).toBeTruthy();
    expect(app.container.querySelectorAll(".mcell").length).toBe(2);

    app.instance.prependRow();
    await app.settle();

    expect(app.container.querySelectorAll("tbody tr").length).toBe(3);
    expect(app.container.querySelectorAll(".task").length).toBe(2);
    expect(app.container.querySelectorAll(".mcell").length).toBe(2);
  });
});
