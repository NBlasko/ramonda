import { describe, test, expect } from "vitest";
import { getDOM } from "../test/setup";
import { state } from "../base/decorators";
import { Component, list } from "../index";

/**
 * What the diff reads back from an element it has just built.
 *
 * Nothing is there to read: a new element has no attributes and no children until the diff writes
 * them. Built through the update path, every new element was asked for its attributes and its
 * `childNodes` anyway, and its children went in through the reorder pass one by one — measured on
 * js-framework-benchmark's create, 28 reads of an empty element per row, and a sixth of the time.
 */
describe("an element the diff builds", () => {
  interface Row {
    readonly id: number;
    readonly label: string;
  }

  class Table extends Component {
    @state rows: Row[] = [];
    row(row: Row) {
      return (
        <tr key={row.id} className="row">
          <td className="id">{row.id}</td>
          <td>
            <a title={row.label}>{row.label}</a>
          </td>
          <td>
            <span aria-hidden="true">x</span>
          </td>
        </tr>
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

  /** Counts reads of `name` on nodes inside a row. */
  function counting(proto: object, name: string, tally: { reads: number }) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name) as PropertyDescriptor;
    Object.defineProperty(proto, name, {
      ...descriptor,
      get(this: Node) {
        if ((this.nodeType === Node.ELEMENT_NODE ? (this as Element) : this.parentElement)?.closest("tr"))
          tally.reads++;
        return descriptor.get?.call(this);
      },
    });
    return () => Object.defineProperty(proto, name, descriptor);
  }

  test("is written, never read back, and holds what it was written", async () => {
    const app = await getDOM<Table>(<Table />);
    await app.settle();
    const tally = { reads: 0 };
    const undo = [counting(Element.prototype, "attributes", tally), counting(Node.prototype, "childNodes", tally)];
    try {
      app.instance.rows = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, label: `row ${i + 1}` }));
      await app.settle();
    } finally {
      for (const u of undo) u();
    }
    const tbody = app.container.querySelector("tbody") as HTMLElement;
    expect({ reads: tally.reads, rows: tbody.children.length, first: tbody.firstElementChild?.outerHTML }).toEqual({
      reads: 0,
      rows: 10,
      first:
        '<tr class="row"><td class="id">1</td><td><a title="row 1">row 1</a></td><td><span aria-hidden="true">x</span></td></tr>',
    });
  });
});
