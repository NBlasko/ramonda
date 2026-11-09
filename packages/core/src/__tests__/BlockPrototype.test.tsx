import { describe, test, expect } from "vitest";
import { getDOM } from "../test/setup";
import { Component, state, list, memoized } from "../index";
import { __template, __block } from "../jsx-runtime";

/** PROTOTYPE: a compiled row — what the compiler would emit for the js-framework-benchmark row. */
const ROW = __template(
  '<tr><td class="col-md-1"> </td><td class="col-md-4"><a> </a></td><td class="col-md-1"><a><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td><td class="col-md-6"></td></tr>',
  [[], [0, 0], [1, 0], [1, 0, 0], [2, 0]],
  [{ at: 0, name: "className" }, { at: 1 }, { at: 2, name: "onclick" }, { at: 3 }, { at: 4, name: "onclick" }],
);

interface Row {
  readonly id: number;
  readonly label: string;
}

class Table extends Component {
  @state rows: Row[] = [1, 2, 3].map((id) => ({ id, label: `row ${id}` }));
  @state selected = 0;
  @memoized
  select(id: number) {
    return () => {
      this.selected = id;
    };
  }
  @memoized
  remove(id: number) {
    return () => {
      this.rows = this.rows.filter((row) => row.id !== id);
    };
  }
  row(row: Row) {
    return __block(
      ROW,
      [this.selected === row.id ? "danger" : "", row.id, this.select(row.id), row.label, this.remove(row.id)],
      row.id,
    );
  }
  render() {
    return (
      <table>
        <tbody>{list(this.rows, this.row)}</tbody>
      </table>
    );
  }
}

describe("a compiled row (prototype)", () => {
  test("is built, selected by its own handler, swapped and removed", async () => {
    const app = await getDOM<Table>(<Table />);
    await app.settle();
    const rows = () => Array.from(app.container.querySelectorAll("tr"));
    const built = rows().map((tr) => tr.textContent);
    const second = rows()[1];
    (second.querySelector("td:nth-child(2) a") as HTMLElement).click();
    await app.settle();
    const classes = rows().map((tr) => tr.className);
    app.instance.rows = [app.instance.rows[2], app.instance.rows[1], app.instance.rows[0]];
    await app.settle();
    const swapped = rows().map((tr) => tr.textContent);
    const kept = rows()[1] === second;
    (rows()[0].querySelector("td:nth-child(3) a") as HTMLElement).click();
    await app.settle();
    expect({ built, classes, swapped, kept, left: rows().map((tr) => tr.textContent) }).toEqual({
      built: ["1row 1", "2row 2", "3row 3"],
      classes: ["", "danger", ""],
      swapped: ["3row 3", "2row 2", "1row 1"],
      kept: true,
      left: ["2row 2", "1row 1"],
    });
  });
});
