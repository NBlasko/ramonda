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
          <tr>{list(this.props.columns, headerCell)}</tr>
        </thead>
        <tbody>
          {list(this.items, (item) => (
            <DataTableRow item={item} />
          ))}
        </tbody>
      </table>
    );
  }
}

/** A cell with the heading it carries — `null` for the first, which IS the heading. */
interface LabelledCell {
  cell: Cell;
  label: string | null;
}

/** One `<tr>`: the first cell names the row, the rest carry their column's heading. */
@Host("tr")
class DataTableRow extends Component<{ item: Row }> {
  /**
   * The position is resolved HERE, where the data is, rather than in the row
   * mapper — which takes the item and nothing else on purpose. A mapper handed
   * its position has to be re-run whenever a row moves, and the position is the
   * one thing that must never become a row's identity.
   */
  @compute
  private get cells(): LabelledCell[] {
    const { cells, labels } = this.props.item;
    return cells.map((cell, index) => ({ cell, label: index === 0 ? null : (labels[index] ?? "") }));
  }

  render(): RamondaNode {
    return list(this.cells, this.cell);
  }

  private cell(at: LabelledCell): VNode {
    return __h("td", at.label === null ? null : { "data-label": at.label }, ...spread(at.cell));
  }
}

const headerCell = (column: Cell): VNode => __h("th", null, ...spread(column));

/** The visible text of a vnode subtree — a heading is short, and `data-label` takes a string. */
function textOf(child: Cell): string {
  if (child == null || typeof child === "boolean") return "";
  if (typeof child === "string" || typeof child === "number") return String(child);
  if (Array.isArray(child)) return (child as Cell[]).map(textOf).join("");
  const children = (child as { props?: { children?: ComponentChild } }).props?.children;
  return children === undefined ? "" : textOf(children);
}
