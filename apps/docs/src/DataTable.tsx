import { Component, Host, compute, __h, list } from "@ramonda/core";
import type { ComponentChild, RamondaNode, VNode } from "@ramonda/core";

/** One cell. An array because a markdown cell is often several nodes — `a **b** c` is three. */
export type Cell = ComponentChild | readonly ComponentChild[];

interface DataTableProps {
  /** The header cells, in order. The first one names the row and is treated as its label. */
  columns: readonly Cell[];
  /** One entry per row, each as long as `columns`. Cells are vnodes, so they can hold links and code. */
  rows: readonly (readonly Cell[])[];
}

/** A row, with its column headings alongside — everything one `<tr>` needs, and nothing more. */
interface Row {
  cells: readonly Cell[];
  labels: readonly string[];
}

const spread = (cell: Cell): ComponentChild[] => (Array.isArray(cell) ? [...cell] : [cell as ComponentChild]);

/**
 * A table that survives a narrow screen.
 *
 * A four-column reference table is unreadable on a phone, and the two usual answers are both bad: let
 * it scroll as one block and the reader loses which row they are on, or squeeze the columns and every
 * cell becomes two words per line.
 *
 * So below 700px a row becomes a card. The first cell — the thing being described — is a full-width
 * bar that stays put, and the rest scroll under it, each carrying its column heading in small type
 * above the value. The reader always knows which row they are reading and which column they are
 * looking at, and no text is squeezed.
 *
 * **The reflow is CSS, and the markup is one table.** The alternative is rendering two trees and
 * hiding one, which doubles the search index and reads the content twice to a screen reader. What
 * this component adds to the DOM is one attribute per cell: `data-label`, holding that column's
 * heading, which is the only thing CSS cannot derive on its own.
 *
 * A wide screen gets an ordinary `<table>` with none of that showing.
 */
@Host("div", () => ({ className: "table-wrap" }))
export class DataTable extends Component<DataTableProps> {
  /**
   * The rows, each carrying the headings it needs.
   *
   * A `@compute`, and not an array built inside `render()`: `list()` reads `each` reactively and
   * drops every item's scope when it is handed a new array, so rebuilding it per render would throw
   * the whole table away on any unrelated re-render. A compute holds one array for as long as the
   * props it read stay put — which, for a table built from content, is always.
   */
  @compute private get items(): Row[] {
    const labels = this.props.columns.map(textOf);
    return this.props.rows.map((cells) => ({ cells, labels }));
  }

  render(): RamondaNode {
    return (
      <table>
        <thead>
          <tr>{list({ each: this.props.columns, render: headerCell })}</tr>
        </thead>
        <tbody>{list({ each: this.items, as: DataTableRow })}</tbody>
      </table>
    );
  }
}

/** One `<tr>`: the first cell names the row, the rest carry their column's heading. */
@Host("tr")
class DataTableRow extends Component<{ item: Row }> {
  render(): RamondaNode {
    return list({ each: this.props.item.cells, render: this.cell });
  }

  private cell(cell: Cell, index: number): VNode {
    // The first column IS the heading, so it gets none of its own.
    const attrs = index === 0 ? null : { "data-label": this.props.item.labels[index] ?? "" };
    return __h("td", attrs, ...spread(cell)) as VNode;
  }
}

const headerCell = (column: Cell): VNode => __h("th", null, ...spread(column)) as VNode;

/** The visible text of a vnode subtree — a heading is short, and `data-label` takes a string. */
function textOf(child: Cell): string {
  if (child == null || typeof child === "boolean") return "";
  if (typeof child === "string" || typeof child === "number") return String(child);
  if (Array.isArray(child)) return (child as Cell[]).map(textOf).join("");
  const children = (child as { props?: { children?: ComponentChild } }).props?.children;
  return children === undefined ? "" : textOf(children);
}
