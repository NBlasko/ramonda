import { describe, test, expect, beforeEach } from "vitest";
import { Component } from "../base/Component";
import { state } from "../base/decorators";
import { list } from "../base/list";
import { getDOM, instanceOf } from "../test/setup";
import { resetDiagnostics } from "../debug/diagnostics";
import { renderPage } from "../hydration/ssr";
import { hydrateRoot } from "../hydration/hydrate";
import type { VNode } from "../types/vdom";

/**
 * `list()` — the same job as the `For` hook, as a plain function call.
 *
 * It exists because `For` is a hook: `use()` runs at CONSTRUCTION, so a
 * component with a list it may never show still builds one, its options callback
 * is re-evaluated on every render, and the declaration sits nowhere near the
 * branch that decides whether the list exists. Several lists meant several
 * declarations, each carrying its markup far from `render()`.
 *
 * It does not bend the one-tag-one-element rule: a function in an expression
 * slot is not a tag, and it is already what RMD011 tells people to reach for.
 *
 * The interesting part is that `list()` returns a DESCRIPTOR — the mapper has
 * not run when it returns. `normalizeChildren` stamps the child position, and
 * the diff builds the items while reconciling the region, which is the only
 * moment the previous region (and therefore the list's state) is in hand.
 */

interface Task {
  title: string;
}

let built = 0;

class Row extends Component<{ item: Task }> {
  @state clicks = 0;
  id = ++built;
  render() {
    return (
      <li>
        <span>
          {this.props.item.title}:{this.clicks}
        </span>
      </li>
    );
  }
}

function texts(root: Element): string[] {
  return [...root.querySelectorAll("li")].map((li) => li.textContent ?? "");
}

beforeEach(() => {
  built = 0;
  resetDiagnostics();
});

describe("list() renders", () => {
  test("with `as`", async () => {
    class Board extends Component {
      @state tasks: Task[] = [{ title: "a" }, { title: "b" }];
      render() {
        return (
          <div>
            <ul>
              {list(this.tasks, (item) => (
                <Row item={item} />
              ))}
            </ul>
          </div>
        );
      }
    }

    const { container } = await getDOM(<Board />);
    expect(texts(container)).toEqual(["a:0", "b:0"]);
  });

  test("with `render`", async () => {
    class Board extends Component {
      @state tasks: Task[] = [{ title: "a" }, { title: "b" }];
      render() {
        return (
          <div>
            <ul>
              {list(this.tasks, (task: Task) => (
                <li>{task.title}</li>
              ))}
            </ul>
          </div>
        );
      }
    }

    const { container } = await getDOM(<Board />);
    expect(texts(container)).toEqual(["a", "b"]);
  });

  test("an empty list renders nothing and does not throw", async () => {
    class Board extends Component {
      @state tasks: Task[] = [];
      render() {
        return (
          <div>
            <ul>
              {list(this.tasks, (item) => (
                <Row item={item} />
              ))}
            </ul>
          </div>
        );
      }
    }

    const { container } = await getDOM(<Board />);
    expect(container.querySelectorAll("li").length).toBe(0);
  });
});

describe("identity — the whole reason For exists, kept", () => {
  class Board extends Component {
    @state tasks: Task[] = [{ title: "a" }, { title: "b" }, { title: "c" }];
    render() {
      return (
        <div>
          <ul>
            {list(this.tasks, (item) => (
              <Row item={item} />
            ))}
          </ul>
        </div>
      );
    }
  }

  test("a reorder moves rows instead of rebuilding them", async () => {
    const { container, instance, settle } = await getDOM<Board>(<Board />);

    const first = instanceOf<Row>(container.querySelectorAll("li")[0]);
    first.clicks = 5;
    await settle();
    expect(texts(container)).toEqual(["a:5", "b:0", "c:0"]);

    const before = [...container.querySelectorAll("li")];
    instance.tasks = [...instance.tasks].reverse();
    await settle();

    // The state moved WITH its task, and no node was rebuilt.
    expect(texts(container)).toEqual(["c:0", "b:0", "a:5"]);
    const after = [...container.querySelectorAll("li")];
    expect(after.filter((node) => before.includes(node)).length).toBe(3);
  });

  test("removing from the middle keeps the survivors' state", async () => {
    const { container, instance, settle } = await getDOM<Board>(<Board />);
    const third = instanceOf<Row>(container.querySelectorAll("li")[2]);
    third.clicks = 9;
    await settle();

    instance.tasks = [instance.tasks[0], instance.tasks[2]];
    await settle();

    // Position matching would have given "c" the middle row's state.
    expect(texts(container)).toEqual(["a:0", "c:9"]);
  });

  test("the same item twice gets its own row each time", async () => {
    const tag: Task = { title: "tag" };

    class Twice extends Component {
      @state tasks: Task[] = [tag, tag];
      render() {
        return (
          <div>
            <ul>
              {list(this.tasks, (item) => (
                <Row item={item} />
              ))}
            </ul>
          </div>
        );
      }
    }

    const { container, settle } = await getDOM(<Twice />);
    const rows = container.querySelectorAll("li");
    expect(rows.length).toBe(2);

    instanceOf<Row>(rows[0]).clicks = 3;
    await settle();

    // Reference identity cannot tell two occurrences apart, and neither could a
    // hand-written key — the engine mints one id per occurrence.
    expect(texts(container)).toEqual(["tag:3", "tag:0"]);
  });

  test("objects re-created per fetch keep their rows", async () => {
    class Refetching extends Component {
      @state tasks = [
        { id: "1", title: "a" },
        { id: "2", title: "b" },
      ];
      render() {
        return (
          <div>
            <ul>
              {list(this.tasks, (task: { id: string; title: string }) => (
                <li>{task.title}</li>
              ))}
            </ul>
          </div>
        );
      }
    }

    const { container, instance, settle } = await getDOM<Refetching>(<Refetching />);
    const before = [...container.querySelectorAll("li")];

    // A refetch: same entities, brand-new objects.
    instance.tasks = [
      { id: "1", title: "a" },
      { id: "2", title: "b*" },
    ];
    await settle();

    expect(texts(container)).toEqual(["a", "b*"]);
    // These are unrecognised objects; identity is carried across, so the nodes
    // are the nodes they were. This is what `key` used to be for.
    expect([...container.querySelectorAll("li")].filter((n) => before.includes(n)).length).toBe(2);
  });

  test("a nested list() returned from `render` is named, not thrown on", async () => {
    // The mistake the docs made: a list of pages, each page a list of rows, written by
    // returning the inner `list()` straight from `render`. It has no `attributes`, so
    // writing the key onto it threw "Cannot set properties of undefined" — a message
    // about the assignment rather than about what to write instead. Nesting goes
    // through a component, whose host element wraps the inner rows.
    const messages: string[] = [];
    const handler = (event: Event) => {
      const message = (event as CustomEvent).detail?.message as string;
      if (message?.startsWith("[RMD031]")) messages.push(message);
    };
    window.addEventListener("ramonda:dev-log", handler);

    try {
      class Pages extends Component {
        @state pages: Task[][] = [[{ title: "a" }], [{ title: "b" }]];
        render() {
          return (
            <div>
              <ul>{list(this.pages, this.page)}</ul>
            </div>
          );
        }
        // Cast: this is exactly what the types reject, and the point is what the
        // RUNTIME does with it — a JavaScript app has no such guard.
        private page(rows: Task[]): VNode {
          return list(rows, (item) => <Row item={item} />) as unknown as VNode;
        }
      }

      const { container } = await getDOM<Pages>(<Pages />);

      expect(messages.join("\n")).toContain("a nested `list()`");
      // Skipped rather than crashed: the page renders, one row short.
      expect(container.querySelectorAll("li").length).toBe(0);
    } finally {
      window.removeEventListener("ramonda:dev-log", handler);
    }
  });
});

describe("the case list() was written for", () => {
  test("a conditional list costs nothing until it is rendered", async () => {
    let mapperRuns = 0;

    class Panel extends Component {
      @state open = false;
      @state tasks: Task[] = [{ title: "a" }];

      render() {
        if (!this.open)
          return (
            <div>
              <p>closed</p>
            </div>
          );
        return (
          <div>
            <ul>
              {list(this.tasks, (task: Task) => {
                mapperRuns++;
                return <li>{task.title}</li>;
              })}
            </ul>
          </div>
        );
      }
    }

    const { container, instance, settle } = await getDOM<Panel>(<Panel />);
    expect(container.textContent).toBe("closed");
    // Nothing was declared, so nothing ran. With a `For` hook the options
    // callback would have been evaluated on this render regardless.
    expect(mapperRuns).toBe(0);

    instance.open = true;
    await settle();
    expect(texts(container)).toEqual(["a"]);
    expect(mapperRuns).toBe(1);
  });

  test("two lists in one element keep their own identity", async () => {
    class Two extends Component {
      @state todo: Task[] = [{ title: "t1" }, { title: "t2" }];
      @state done: Task[] = [{ title: "d1" }];

      render() {
        return (
          <div>
            <div>
              <ul id="todo">
                {list(this.todo, (item) => (
                  <Row item={item} />
                ))}
              </ul>
              <ul id="done">
                {list(this.done, (item) => (
                  <Row item={item} />
                ))}
              </ul>
            </div>
          </div>
        );
      }
    }

    const { container, instance, settle } = await getDOM<Two>(<Two />);
    const todoRow = instanceOf<Row>(container.querySelector("#todo li"));
    todoRow.clicks = 4;
    await settle();

    instance.done = [...instance.done, { title: "d2" }];
    await settle();

    // Both lists mint `f0`, `f1` — the regions are what keeps them apart.
    expect(texts(container.querySelector("#todo")!)).toEqual(["t1:4", "t2:0"]);
    expect(texts(container.querySelector("#done")!)).toEqual(["d1:0", "d2:0"]);
  });

  test("a list beside ordinary siblings does not claim them", async () => {
    class WithChrome extends Component {
      @state tasks: Task[] = [{ title: "a" }];
      render() {
        return (
          <div>
            <ul>
              <li id="head">HEAD</li>
              {list(this.tasks, (item) => (
                <Row item={item} />
              ))}
              <li id="foot">FOOT</li>
            </ul>
          </div>
        );
      }
    }

    const { container, instance, settle } = await getDOM<WithChrome>(<WithChrome />);
    const head = container.querySelector("#head");
    const foot = container.querySelector("#foot");

    instance.tasks = [...instance.tasks, { title: "b" }];
    await settle();

    // The chrome is the same nodes, and still at the ends.
    expect(container.querySelector("#head")).toBe(head);
    expect(container.querySelector("#foot")).toBe(foot);
    expect(texts(container)).toEqual(["HEAD", "a:0", "b:0", "FOOT"]);
  });

  test("identity is positional, so a conditional sibling cannot shift it", async () => {
    // The failure this guards: identifying a list by CALL ORDER instead of by
    // position. `{cond && list(a)}` stops being the first call the moment `cond`
    // is false, and the region — with its state — would go to the wrong list.
    class Shifting extends Component {
      @state showFirst = true;
      @state a: Task[] = [{ title: "a" }];
      @state b: Task[] = [{ title: "b" }];

      render() {
        return (
          <div>
            <ul>
              {this.showFirst ? list(this.a, (item) => <Row item={item} />) : null}
              {list(this.b, (item) => (
                <Row item={item} />
              ))}
            </ul>
          </div>
        );
      }
    }

    const { container, instance, settle } = await getDOM<Shifting>(<Shifting />);
    const bRow = instanceOf<Row>(container.querySelectorAll("li")[1]);
    bRow.clicks = 7;
    await settle();
    expect(texts(container)).toEqual(["a:0", "b:7"]);

    instance.showFirst = false;
    await settle();

    // `b` kept its own state rather than inheriting `a`'s region.
    expect(texts(container)).toEqual(["b:7"]);
  });
});

describe("nesting and composition", () => {
  test("a list inside a list", async () => {
    interface Group {
      name: string;
      items: Task[];
    }

    class GroupRow extends Component<{ item: Group }> {
      render() {
        return (
          <li>
            <ul>
              {list(this.props.item.items, (task: Task) => (
                <li>{task.title}</li>
              ))}
            </ul>
          </li>
        );
      }
    }

    class Nested extends Component {
      @state groups: Group[] = [
        { name: "g1", items: [{ title: "a" }, { title: "b" }] },
        { name: "g2", items: [{ title: "c" }] },
      ];
      render() {
        return (
          <div>
            <ul>
              {list(this.groups, (item) => (
                <GroupRow item={item} />
              ))}
            </ul>
          </div>
        );
      }
    }

    const { container, instance, settle } = await getDOM<Nested>(<Nested />);
    expect(container.textContent).toBe("abc");

    instance.groups = [...instance.groups].reverse();
    await settle();
    expect(container.textContent).toBe("cab");
  });

  test("two lists in DIFFERENT elements keep their own identity", async () => {
    class Split extends Component {
      @state left: Task[] = [{ title: "l1" }];
      @state right: Task[] = [{ title: "r1" }];

      render() {
        return (
          <div>
            <div>
              <ul id="left">
                {list(this.left, (item) => (
                  <Row item={item} />
                ))}
              </ul>
              <ul id="right">
                {list(this.right, (item) => (
                  <Row item={item} />
                ))}
              </ul>
            </div>
          </div>
        );
      }
    }

    const { container, instance, settle } = await getDOM<Split>(<Split />);
    instance.right = [...instance.right, { title: "r2" }];
    await settle();

    // Both were written at child index 0 of their own element, so both mint the
    // same positional id — they stay apart because regions are scoped to the
    // parent's record, not shared across the component.
    expect(texts(container.querySelector("#left")!)).toEqual(["l1:0"]);
    expect(texts(container.querySelector("#right")!)).toEqual(["r1:0", "r2:0"]);
  });
});

describe("the whole-list skip still applies", () => {
  test("an unrelated re-render does not run the mapper again", async () => {
    let mapperRuns = 0;

    class Board extends Component {
      @state unrelated = 0;
      @state tasks: Task[] = [{ title: "a" }, { title: "b" }];

      /** A METHOD: the skip turns on the callback's identity, and a method's is stable. */
      row(task: Task) {
        mapperRuns++;
        return <li>{task.title}</li>;
      }

      render() {
        return (
          <div>
            <div>
              <p>{this.unrelated}</p>
              <ul>{list(this.tasks, this.row)}</ul>
            </div>
          </div>
        );
      }
    }

    const { instance, settle } = await getDOM<Board>(<Board />);
    expect(mapperRuns).toBe(2);

    instance.unrelated = 1;
    await settle();

    // Same array reference, nothing invalidated: the engine hands back the very
    // same ListNode and the region is left alone.
    expect(mapperRuns).toBe(2);
  });
});

describe("server rendering and hydration", () => {
  class Board extends Component {
    @state tasks: Task[] = [{ title: "a" }, { title: "b" }, { title: "c" }];
    render() {
      return (
        <div>
          <ul>
            {list(this.tasks, (item) => (
              <Row item={item} />
            ))}
          </ul>
        </div>
      );
    }
  }

  test("renders on the server", async () => {
    const page = await renderPage(<Board />);
    expect(page.body).toContain("a:0");
    expect(page.body).toContain("c:0");
  });

  test("a reorder after hydration moves rows rather than rebuilding", async () => {
    const page = await renderPage(<Board />);
    const element = document.createElement("div");
    document.body.appendChild(element);
    element.innerHTML = page.body;

    hydrateRoot(<Board />, element);
    await Promise.resolve();

    const instance = instanceOf<Board>(element.firstChild);
    const first = instanceOf<Row>(element.querySelectorAll("li")[0]);
    first.clicks = 5;
    await Promise.resolve();
    await Promise.resolve();

    const before = [...element.querySelectorAll("li")];
    instance.tasks = [...instance.tasks].reverse();
    await Promise.resolve();
    await Promise.resolve();

    // The bug that cost a whole list on every prerendered page:
    // "Hook options were never refreshed after a state restore". `list()` takes
    // its options from the render, so it cannot go stale that way at all.
    expect(texts(element)).toEqual(["c:0", "b:0", "a:5"]);
    expect([...element.querySelectorAll("li")].filter((n) => before.includes(n)).length).toBe(3);

    element.remove();
  });
});

describe("a two-dimensional list", () => {
  interface Cell {
    label: string;
  }
  interface GridRow {
    name: string;
    cells: Cell[];
  }

  class CellView extends Component<{ item: Cell }> {
    @state clicks = 0;
    render() {
      return (
        <td>
          <span>
            {this.props.item.label}:{this.clicks}
          </span>
        </td>
      );
    }
  }

  /**
   * Both dimensions inline, in one `render()`.
   *
   * This is the case that shows what `list()` buys. With the `For` hook, the
   * inner list CANNOT be written here: `use()` must run at construction, so it
   * cannot be called from inside a mapper — which is why the matrix demo in the
   * playground has to introduce a Row component whose only job is to own a
   * second hook. Composition is a fine answer when the row is a real thing; it
   * is ceremony when the row is just a `<tr>`.
   */
  class Grid extends Component {
    @state rows: GridRow[] = [
      { name: "r1", cells: [{ label: "a" }, { label: "b" }] },
      { name: "r2", cells: [{ label: "c" }, { label: "d" }] },
    ];

    render() {
      return (
        <table>
          <tbody>
            {list(this.rows, (row: GridRow) => (
              <tr>
                {list(row.cells, (item) => (
                  <CellView item={item} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
  }

  function grid(root: Element): string[][] {
    return [...root.querySelectorAll("tr")].map((tr) =>
      [...tr.querySelectorAll("td")].map((td) => td.textContent ?? ""),
    );
  }

  test("renders both dimensions", async () => {
    const { container } = await getDOM(<Grid />);
    expect(grid(container)).toEqual([
      ["a:0", "b:0"],
      ["c:0", "d:0"],
    ]);
  });

  test("reordering ROWS carries each row's cells and their state", async () => {
    const { container, instance, settle } = await getDOM<Grid>(<Grid />);

    // Give one cell in the first row some state of its own.
    const cell = instanceOf<CellView>(container.querySelectorAll("td")[0]);
    cell.clicks = 7;
    await settle();

    const rowsBefore = [...container.querySelectorAll("tr")];
    instance.rows = [...instance.rows].reverse();
    await settle();

    // The whole row moved, cells intact, and the cell kept its state. The inner
    // region's state lives on the <tr>'s own record, so it travels with the node.
    expect(grid(container)).toEqual([
      ["c:0", "d:0"],
      ["a:7", "b:0"],
    ]);
    const rowsAfter = [...container.querySelectorAll("tr")];
    expect(rowsAfter.filter((tr) => rowsBefore.includes(tr)).length).toBe(2);
  });

  test("reordering CELLS moves them with their state", async () => {
    const { container, instance, settle } = await getDOM<Grid>(<Grid />);

    const second = instanceOf<CellView>(container.querySelectorAll("td")[1]);
    second.clicks = 4;
    await settle();
    expect(grid(container)[0]).toEqual(["a:0", "b:4"]);

    const first = instance.rows[0];
    instance.rows = [{ ...first, cells: [...first.cells].reverse() }, instance.rows[1]];
    await settle();

    // `b` moved to the front and took its 4 with it — the inner list identifies
    // cells by the item object, which the spread above preserved.
    expect(grid(container)[0]).toEqual(["b:4", "a:0"]);
  });

  test("adding a column touches only the rows it is added to", async () => {
    const { container, instance, settle } = await getDOM<Grid>(<Grid />);
    const cellsBefore = [...container.querySelectorAll("td")];

    instance.rows = instance.rows.map((row) => ({
      ...row,
      cells: [...row.cells, { label: `${row.name}-new` }],
    }));
    await settle();

    expect(grid(container)).toEqual([
      ["a:0", "b:0", "r1-new:0"],
      ["c:0", "d:0", "r2-new:0"],
    ]);
    // The four original cells are the same nodes; only two were created.
    const cellsAfter = [...container.querySelectorAll("td")];
    expect(cellsAfter.filter((td) => cellsBefore.includes(td)).length).toBe(4);
  });

  test("each row's inner list has its own key space", async () => {
    // Both inner lists mint `f0`, `f1` — they must not see each other. The
    // regions are per <tr>, which is what keeps them apart.
    const { container, settle } = await getDOM<Grid>(<Grid />);

    const firstOfRowTwo = instanceOf<CellView>(container.querySelectorAll("tr")[1].querySelectorAll("td")[0]);
    firstOfRowTwo.clicks = 2;
    await settle();

    expect(grid(container)).toEqual([
      ["a:0", "b:0"],
      ["c:2", "d:0"],
    ]);
  });

  test("a ragged array works, and a row can empty out", async () => {
    class Ragged extends Component {
      @state rows: Cell[][] = [[{ label: "a" }, { label: "b" }], [{ label: "c" }], []];
      render() {
        return (
          <table>
            <tbody>
              {list(this.rows, (cells: Cell[]) => (
                <tr>
                  {list(cells, (item) => (
                    <CellView item={item} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        );
      }
    }

    const { container, instance, settle } = await getDOM<Ragged>(<Ragged />);
    expect(grid(container)).toEqual([["a:0", "b:0"], ["c:0"], []]);

    instance.rows = [[], [{ label: "c" }], [{ label: "z" }]];
    await settle();
    expect(grid(container)).toEqual([[], ["c:0"], ["z:0"]]);
  });
});

describe("two dimensions without keys", () => {
  interface Cell2 {
    label: string;
  }

  class Cell2View extends Component<{ item: Cell2 }> {
    @state clicks = 0;
    render() {
      return (
        <td>
          <span>
            {this.props.item.label}:{this.clicks}
          </span>
        </td>
      );
    }
  }

  function grid2(root: Element): string[][] {
    return [...root.querySelectorAll("tr")].map((tr) =>
      [...tr.querySelectorAll("td")].map((td) => td.textContent ?? ""),
    );
  }

  /**
   * The key-free answer in two dimensions: the ROW owns its cells.
   *
   * The no-key promise has one condition, in one dimension and two alike —
   * **item objects must stay stable**. In 1D that is free. In 2D an immutable
   * update to a row's cells produces a new row object by construction, which is
   * a different row, so the outer list rebuilds it and everything inside goes.
   *
   * Measured, and the `For` hook behaves identically — this is not something
   * `list()` introduced:
   *
   *   For  + new row object   ["a:3","b:0"] → ["b:0","a:0"]   state lost
   *   list + new row object   ["a:3","b:0"] → ["b:0","a:0"]   state lost
   *
   * Mutating `row.cells` and replacing only the outer array does not help
   * either — and that is correct rather than broken. The outer list's per-item
   * scope sees the same object and no changed signal, so the row is CLEAN: its
   * vnode is reused untouched and the diff never walks in. A plain field on a
   * plain object is not reactive, so the edit is invisible.
   *
   *   For / list + same row object   ["a:3","b:0"] → ["a:3","b:0"]   nothing happens
   *
   * Moving the cells into the row component's own `@state` removes the question
   * entirely: an edit is a signal write on that component, the outer list is
   * never re-rendered, and no identity has to be asserted anywhere.
   */
  class OwningRow extends Component<{ item: { name: string; cells: Cell2[] } }> {
    @state cells: Cell2[] = this.props.item.cells;

    reverse() {
      this.cells = [...this.cells].reverse();
    }

    render() {
      // A list returned STRAIGHT from render(), with no element around it.
      return (
        <tr>
          {list(this.cells, (item) => (
            <Cell2View item={item} />
          ))}
        </tr>
      );
    }
  }

  class Sheet extends Component {
    @state rows = [
      { name: "r1", cells: [{ label: "a" }, { label: "b" }] },
      { name: "r2", cells: [{ label: "c" }] },
    ];
    render() {
      return (
        <table>
          <tbody>
            {list(this.rows, (item) => (
              <OwningRow item={item} />
            ))}
          </tbody>
        </table>
      );
    }
  }

  test("editing a row's cells keeps their state, with no key anywhere", async () => {
    const { container, settle } = await getDOM(<Sheet />);
    expect(grid2(container)).toEqual([["a:0", "b:0"], ["c:0"]]);

    const cell = instanceOf<Cell2View>(container.querySelectorAll("td")[0]);
    cell.clicks = 3;
    await settle();

    const row = instanceOf<OwningRow>(container.querySelector("tr"));
    row.reverse();
    await settle();

    // Reordered, and the 3 travelled with its cell.
    expect(grid2(container)).toEqual([["b:0", "a:3"], ["c:0"]]);
  });

  test("a list returned straight from render() works", async () => {
    // `return list({…})` rather than `<ul>{list({…})}</ul>`. This path bypasses
    // `normalizeChildren`, so the descriptor arrived with no owner — its region
    // had an undefined identity and its unbuilt vnodes reached the reorder pass.
    // Measured as `insertBefore: parameter 1 is not of type 'Node'`: a crash,
    // not a wrong render. A `For` hook never hit it, because its ListNode
    // arrives owned by the instance.
    const { container, settle } = await getDOM(<Sheet />);
    expect(container.querySelectorAll("tr").length).toBe(2);

    const row = instanceOf<OwningRow>(container.querySelector("tr"));
    row.reverse();
    await settle();

    expect(grid2(container)[0]).toEqual(["b:0", "a:0"]);
  });
});

describe("the cost of the key-free 2D shape", () => {
  interface Cell3 {
    label: string;
  }
  interface Row3 {
    name: string;
    cells: Cell3[];
  }

  class Cell3View extends Component<{ item: Cell3 }> {
    render() {
      return (
        <td>
          <span>{this.props.item.label}</span>
        </td>
      );
    }
  }

  /**
   * `@state cells = this.props.item.cells` makes the ROW the owner of that data.
   *
   * That is what removes the need for a key — but it is the classic
   * derived-state-from-props trade, and it has to be stated: the field is seeded
   * ONCE, at construction, so the parent can no longer push anything into it.
   * Measured below: the parent adds a cell and the row does not see it, even
   * though the row itself kept its identity.
   *
   * So "no keys in 2D" is an architectural choice, not a trick. It is right when
   * a row genuinely owns its rows-worth of data and edits are local. It is wrong
   * the moment the parent is the source of truth.
   */
  class OwningRow3 extends Component<{ item: Row3 }> {
    @state cells: Cell3[] = this.props.item.cells;
    render() {
      return (
        <tr>
          {list(this.cells, (item) => (
            <Cell3View item={item} />
          ))}
        </tr>
      );
    }
  }

  /** The other shape: the row reads through, and the parent stays in charge. */
  class PropsRow3 extends Component<{ item: Row3 }> {
    render() {
      return (
        <tr>
          {list(this.props.item.cells, (item) => (
            <Cell3View item={item} />
          ))}
        </tr>
      );
    }
  }

  function sheetOf(RowComp: typeof OwningRow3 | typeof PropsRow3) {
    class Sheet extends Component {
      @state rows: Row3[] = [{ name: "r1", cells: [{ label: "a" }] }];
      render() {
        return (
          <table>
            <tbody>
              {list(this.rows, (row) => {
                const R = RowComp as typeof OwningRow3;
                return <R item={row} />;
              })}
            </tbody>
          </table>
        );
      }
    }
    return Sheet;
  }

  function cells(root: Element): string[] {
    return [...root.querySelectorAll("td")].map((td) => td.textContent ?? "");
  }

  test("a row that OWNS its cells cannot be updated by the parent", async () => {
    const Sheet = sheetOf(OwningRow3);
    const { container, instance, settle } = await getDOM<InstanceType<typeof Sheet>>(<Sheet />);
    expect(cells(container)).toEqual(["a"]);

    instance.rows = [{ name: "r1", cells: [{ label: "a" }, { label: "NEW" }] }];
    await settle();
    await settle();

    // Unchanged: `@state` was seeded at construction and the parent's array is
    // no longer what this row renders.
    expect(cells(container)).toEqual(["a"]);
  });

  test("a row that reads through props does see the parent's update", async () => {
    const Sheet = sheetOf(PropsRow3);
    const { container, instance, settle } = await getDOM<InstanceType<typeof Sheet>>(<Sheet />);

    instance.rows = [{ name: "r1", cells: [{ label: "a" }, { label: "NEW" }] }];
    await settle();
    await settle();

    expect(cells(container)).toEqual(["a", "NEW"]);
  });
});

describe("what NO key costs in two dimensions", () => {
  interface Cell4 {
    label: string;
  }
  interface Row4 {
    name: string;
    cells: Cell4[];
  }

  class Cell4View extends Component<{ item: Cell4 }> {
    @state clicks = 0;
    render() {
      return (
        <td>
          <span>
            {this.props.item.label}:{this.clicks}
          </span>
        </td>
      );
    }
  }

  /** The two-dimensional shape, with nothing declared about identity. */
  class Unkeyed extends Component {
    @state rows: Row4[] = [
      { name: "r1", cells: [{ label: "a" }, { label: "b" }] },
      { name: "r2", cells: [{ label: "c" }, { label: "d" }] },
    ];
    render() {
      return (
        <table>
          <tbody>
            {list(this.rows, (row: Row4) => (
              <tr>
                {list(row.cells, (item) => (
                  <Cell4View item={item} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
  }

  function grid4(root: Element): string[][] {
    return [...root.querySelectorAll("tr")].map((tr) =>
      [...tr.querySelectorAll("td")].map((td) => td.textContent ?? ""),
    );
  }

  /** Distinct state in every cell, so any mix-up is visible rather than plausible. */
  async function marked() {
    const result = await getDOM<Unkeyed>(<Unkeyed />);
    [...result.container.querySelectorAll("td")].forEach((td, i) => {
      instanceOf<Cell4View>(td).clicks = i + 1;
    });
    await result.settle();
    return result;
  }

  test("reordering rows needs no key at all", async () => {
    const { container, instance, settle } = await marked();
    expect(grid4(container)).toEqual([
      ["a:1", "b:2"],
      ["c:3", "d:4"],
    ]);

    instance.rows = [...instance.rows].reverse();
    await settle();

    // The row objects are the same, so identity holds and every cell's state
    // travels with it. This is the case `.map()` gets wrong — it matches by
    // position, so the state would have stayed behind on the wrong row.
    expect(grid4(container)).toEqual([
      ["c:3", "d:4"],
      ["a:1", "b:2"],
    ]);
  });

  test("editing one row moves its cells rather than resetting them", async () => {
    const { container, instance, settle } = await marked();
    const before = [...container.querySelectorAll("td")];

    const first = instance.rows[0];
    instance.rows = [{ ...first, cells: [...first.cells].reverse() }, instance.rows[1]];
    await settle();

    // The edited row is a REPLACED object, and its identity is carried across —
    // so the row is the row it was, and its cells (the same objects, reversed)
    // travel with their state rather than being reset. The other row did not
    // notice, and its two nodes are the same objects.
    //
    // This used to read `["b:0", "a:0"]`: the replaced row object matched
    // nothing, the row was rebuilt, and rebuilding it cascaded into its cells.
    // Nothing about the data said those cells should start again.
    expect(grid4(container)).toEqual([
      ["b:2", "a:1"],
      ["c:3", "d:4"],
    ]);
    // All four, not two. The untouched row never noticed, and the edited row's
    // cells were reordered rather than rebuilt — so not one node was replaced.
    expect([...container.querySelectorAll("td")].filter((td) => before.includes(td)).length).toBe(4);
  });

  test("state is never WRONG — it follows the item", async () => {
    const { container, instance, settle } = await marked();

    // The worst case: every row object replaced AND the rows reversed. Nothing
    // here shares a reference with what is on screen.
    instance.rows = [...instance.rows].reverse().map((row) => ({ ...row }));
    await settle();

    // Every cell's state arrived with its own content. What must never appear is
    // `["a:3","b:4"]` — the second row's state on the first row's items.
    //
    // That is the difference from an unkeyed list matched by INDEX: there the
    // state stays at its position and lands on whatever moved into it, which is
    // silently wrong. Here identity is carried on the item, so a replaced object
    // is still the row it replaced — and a row that is genuinely new gets
    // nothing, because there is no row for it to have been.
    //
    // This used to read all zeroes. State was never wrong then either, but it was
    // always LOST, and a refetch is the ordinary way an app gets its data.
    expect(grid4(container)).toEqual([
      ["c:3", "d:4"],
      ["a:1", "b:2"],
    ]);
  });
});

describe("your key, and what happens when two rows share one", () => {
  interface Priced {
    id: number;
    name: string;
  }

  function reported(): { codes: string[]; stop(): void } {
    const codes: string[] = [];
    const handler = (event: Event) => {
      const message = (event as CustomEvent).detail?.message as string;
      const code = message?.match(/^\[(RMD\d+)\]/)?.[1];
      if (code) codes.push(code);
    };
    window.addEventListener("ramonda:dev-log", handler);
    return { codes, stop: () => window.removeEventListener("ramonda:dev-log", handler) };
  }

  test("a key you write survives — the list does not overwrite it", async () => {
    // The whole point of writing one. This used to be assigned over with the
    // list's own minted id, so a key was accepted and then ignored.
    class Board extends Component {
      @state rows: Priced[] = [
        { id: 7, name: "a" },
        { id: 9, name: "b" },
      ];
      render() {
        return (
          <div>
            <ul>
              {list(this.rows, (r: Priced) => (
                <li key={r.id}>{r.name}</li>
              ))}
            </ul>
          </div>
        );
      }
    }

    const { container } = await getDOM(<Board />);
    const keys = [...container.querySelectorAll("li")].map(
      (li) => (li as unknown as { [k: symbol]: unknown })[Symbol.for("ramonda.key")],
    );
    // The DOM carries what was written, not a generated id.
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(keys.length).toBe(2);
  });

  test("a key answers when the objects are all new", async () => {
    // A refetch: nothing shares a reference with what is on screen, so the object
    // cannot say which row is which. The key can, and it is exact.
    class Board extends Component {
      @state rows: Priced[] = [
        { id: 7, name: "a" },
        { id: 9, name: "b" },
      ];
      render() {
        return (
          <div>
            <ul>
              {list(this.rows, (r: Priced) => (
                <li key={r.id}>{r.name}</li>
              ))}
            </ul>
          </div>
        );
      }
    }

    const app = await getDOM<Board>(<Board />);
    await app.settle();
    const before = [...app.container.querySelectorAll("li")];

    app.instance.rows = [
      { id: 9, name: "b" },
      { id: 7, name: "A!" },
    ];
    await app.settle();

    const after = [...app.container.querySelectorAll("li")];
    expect(after.map((li) => li.textContent)).toEqual(["b", "A!"]);
    // Both rows moved rather than being rebuilt: 9 is the node 9 had, 7 is 7's.
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);
  });

  test("two rows under one key are reported", async () => {
    // Identity used to be minted, so a collision could not be written. It is
    // yours now, and a field that is not unique is a mistake worth saying out
    // loud — the DOM match is what it drives.
    class Board extends Component {
      @state rows: Priced[] = [
        { id: 7, name: "a" },
        { id: 7, name: "b" },
      ];
      render() {
        return (
          <div>
            <ul>
              {list(this.rows, (r: Priced) => (
                <li key={r.id}>{r.name}</li>
              ))}
            </ul>
          </div>
        );
      }
    }

    const seen = reported();
    await getDOM<Board>(<Board />);
    seen.stop();

    expect(seen.codes).toContain("RMD002");
  });

  test("the same OBJECT twice is not a collision", async () => {
    // One object rendered twice is a legitimate list, and its two rows carry the
    // same key because the key is derived from the object. The rows are told
    // apart by which occurrence they are, exactly as they always were.
    const shared: Priced = { id: 7, name: "tag" };

    class Board extends Component {
      @state rows: Priced[] = [shared, shared];
      render() {
        return (
          <div>
            <ul>
              {list(this.rows, (r: Priced) => (
                <li>{r.name}</li>
              ))}
            </ul>
          </div>
        );
      }
    }

    const seen = reported();
    const { container } = await getDOM(<Board />);
    seen.stop();

    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(seen.codes).not.toContain("RMD002");
  });
});

describe("what list() returns, and what it does not", () => {
  test("nothing has run when it returns", () => {
    // The one thing that separates it from `.map()`, and the one thing you cannot
    // see: the callback is called by the framework when it renders the list, not
    // here. That is what makes a list whose array did not change cost nothing.
    let calls = 0;
    list([{ t: "a" }, { t: "b" }], (item: { t: string }) => {
      calls++;
      return <li>{item.t}</li>;
    });

    expect(calls).toBe(0);
  });

  test("reaching for it as an array says so", () => {
    // TypeScript refuses all of these, so getting here means the types were
    // bypassed — an `any`, a cast, plain JavaScript. `undefined`, `is not a
    // function` and `is not iterable` say nothing about what happened.
    const rows = list([{ t: "a" }], (item: { t: string }) => <li>{item.t}</li>) as unknown as {
      length: number;
      map: () => unknown;
      forEach: () => unknown;
    };

    expect(() => rows.length).toThrow(/description of a list, not an array/);
    expect(() => rows.map()).toThrow(/\.map\(\)/);
    expect(() => rows.forEach()).toThrow(/\.forEach\(\)/);
    expect(() => [...(rows as unknown as Iterable<unknown>)]).toThrow(/spreading it/);
    // And it points at the two things that ARE right.
    expect(() => rows.length).toThrow(/items\.map/);
  });

  test("it is still an ordinary child, rendered where it sits", async () => {
    class Board extends Component {
      @state rows = [{ t: "a" }, { t: "b" }];
      render() {
        return (
          <div>
            <ul>
              {list(this.rows, (r: { t: string }) => (
                <li>{r.t}</li>
              ))}
            </ul>
          </div>
        );
      }
    }

    const { container } = await getDOM(<Board />);
    expect([...container.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["a", "b"]);
  });
});

describe("a list that is only partly keyed", () => {
  interface Row5 {
    id: number;
    label: string;
  }

  /** Refetches with one row changed, and reports what survived. */
  async function refetch(row: (r: Row5) => VNode) {
    class Board extends Component {
      @state rows: Row5[] = [
        { id: 1, label: "a" },
        { id: 2, label: "b" },
        { id: 3, label: "c" },
      ];
      render() {
        return (
          <div>
            <ul>{list(this.rows, row)}</ul>
          </div>
        );
      }
    }

    const app = await getDOM<Board>(<Board />);
    await app.settle();
    const before = [...app.container.querySelectorAll("li")];

    // Every object is new — the shape a refetch takes.
    app.instance.rows = [
      { id: 1, label: "a" },
      { id: 2, label: "B!" },
      { id: 3, label: "c" },
    ];
    await app.settle();

    const after = [...app.container.querySelectorAll("li")];
    return after.filter((node) => before.includes(node)).length;
  }

  test("keeps its rows, like a fully keyed and a fully unkeyed one", async () => {
    // Skipping the array alignment for a list that "has keys" made this shape
    // WORSE than having none: the alignment was skipped for every row, so the
    // rows without a key had nothing left to be recognised by. Measured before
    // the fix — one row of three survived, and the marked row was lost.
    //
    // A half-keyed list is what a migration leaves behind halfway through, which
    // is exactly when it must not quietly get worse than where it started.
    const keyed = await refetch((r: Row5) => <Row item={{ title: r.label }} key={r.id} />);
    const unkeyed = await refetch((r: Row5) => <Row item={{ title: r.label }} />);
    const partly = await refetch((r: Row5) =>
      r.id === 1 ? <Row item={{ title: r.label }} key={r.id} /> : <Row item={{ title: r.label }} />,
    );

    expect(keyed).toBe(3);
    expect(unkeyed).toBe(3);
    expect(partly).toBe(3);
  });

  test("a key of 0 is a key", async () => {
    // `0` is falsy, and the check that decides whether to fill one in has to be
    // about presence rather than truth.
    const kept = await refetch((r: Row5) => <Row item={{ title: r.label }} key={r.id - 1} />);
    expect(kept).toBe(3);
  });
});
