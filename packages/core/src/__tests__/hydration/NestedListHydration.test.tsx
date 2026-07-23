import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../../test/setup";
import { Component, Host, list, state } from "../../index";
import { hydrateRoot } from "../../hydration/hydrate";

const microtask = () => Promise.resolve();

/**
 * Hydration builds the child record from the nodes the SERVER produced, and
 * that record has to nest the same way the diff's does. It did not: a list
 * inside a group was handed to `hydrateNode` as if it were a vnode, which threw
 * `Cannot read properties of undefined (reading 'name')` — the page did not
 * render at all.
 */

interface Cell {
  v: string;
}
interface Row {
  label: string;
  cells: Cell[];
}

const makeRow = (label: string): Row => ({
  label,
  cells: [{ v: `${label}1` }, { v: `${label}2` }],
});

/** Nesting through a component per level — a <tr> owning a list over its cells. */
@Host("tr")
class TableRow extends Component<{ item: Row }> {
  render() {
    return [
      <td className="lbl">{this.props.item.label}</td>,
      list({ each: this.props.item.cells, render: (cell: Cell) => <td>{cell.v}</td> }),
    ];
  }
}

@Host("div")
class TableApp extends Component {
  @state rows: Row[] = [makeRow("A"), makeRow("B")];
  render() {
    return (
      <table>
        <tbody>{list({ each: this.rows, as: TableRow })}</tbody>
      </table>
    );
  }
}

/** A list nested inside a GROUP, at one element level — no component between. */
@Host("div")
class GroupApp extends Component {
  @state rows: Row[] = [makeRow("X")];
  render() {
    return (
      <ul>
        {[
          <li className="head">HEAD</li>,
          list({ each: this.rows, render: (row: Row) => <li>{row.label}</li> }),
          <li className="foot">FOOT</li>,
        ]}
      </ul>
    );
  }
}

async function hydrateFromServer(vnode: JSX.Element) {
  const server = await getDOM(vnode);
  await server.settle();
  const html = server.container.innerHTML;
  server.unmount();

  const container = document.createElement("div");
  document.body.appendChild(container);
  container.innerHTML = html;
  const serverNodes = Array.from(container.querySelectorAll("*"));

  hydrateRoot(vnode, container);
  await microtask();
  return { container, serverNodes };
}

describe("hydration: nested lists", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("a component per level adopts, then updates", async () => {
    const { container, serverNodes } = await hydrateFromServer(<TableApp />);

    // Adopted, not rebuilt.
    for (const cell of container.querySelectorAll("td")) {
      expect(serverNodes).toContain(cell);
    }

    const host = container.firstElementChild as unknown as {
      _componentInstance: TableApp;
    };
    host._componentInstance.rows = [makeRow("Z"), ...host._componentInstance.rows];
    await microtask();
    await microtask();

    expect(Array.from(container.querySelectorAll("tr")).map((r) => r.textContent)).toEqual(["ZZ1Z2", "AA1A2", "BB1B2"]);

    container.remove();
  });

  test("a list inside a group hydrates, and the chrome around it holds", async () => {
    const { container, serverNodes } = await hydrateFromServer(<GroupApp />);

    expect(Array.from(container.querySelectorAll("li")).map((l) => l.textContent)).toEqual(["HEAD", "X", "FOOT"]);
    for (const item of container.querySelectorAll("li")) {
      expect(serverNodes).toContain(item);
    }

    const host = container.firstElementChild as unknown as {
      _componentInstance: GroupApp;
    };
    host._componentInstance.rows = [makeRow("Y"), ...host._componentInstance.rows];
    await microtask();
    await microtask();

    expect(Array.from(container.querySelectorAll("li")).map((l) => l.textContent)).toEqual(["HEAD", "Y", "X", "FOOT"]);

    container.remove();
  });
});
