import { describe, test, expect, beforeEach } from "vitest";
import { Component } from "../base/Component";
import { Host, state } from "../base/decorators";
import { list } from "../base/list";
import { getDOM } from "../test/setup";
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

@Host("li")
class Row extends Component<{ item: Task }> {
  @state clicks = 0;
  id = ++built;
  render() {
    return (
      <span>
        {this.props.item.title}:{this.clicks}
      </span>
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
    @Host("div")
    class Board extends Component {
      @state tasks: Task[] = [{ title: "a" }, { title: "b" }];
      render() {
        return <ul>{list({ each: this.tasks, as: Row })}</ul>;
      }
    }

    const { container } = await getDOM(<Board />);
    expect(texts(container)).toEqual(["a:0", "b:0"]);
  });

  test("with `render`", async () => {
    @Host("div")
    class Board extends Component {
      @state tasks: Task[] = [{ title: "a" }, { title: "b" }];
      render() {
        return (
          <ul>
            {list({
              each: this.tasks,
              render: (task: Task) => <li>{task.title}</li>,
            })}
          </ul>
        );
      }
    }

    const { container } = await getDOM(<Board />);
    expect(texts(container)).toEqual(["a", "b"]);
  });

  test("an empty list renders nothing and does not throw", async () => {
    @Host("div")
    class Board extends Component {
      @state tasks: Task[] = [];
      render() {
        return <ul>{list({ each: this.tasks, as: Row })}</ul>;
      }
    }

    const { container } = await getDOM(<Board />);
    expect(container.querySelectorAll("li").length).toBe(0);
  });
});

describe("identity — the whole reason For exists, kept", () => {
  @Host("div")
  class Board extends Component {
    @state tasks: Task[] = [{ title: "a" }, { title: "b" }, { title: "c" }];
    render() {
      return <ul>{list({ each: this.tasks, as: Row })}</ul>;
    }
  }

  test("a reorder moves rows instead of rebuilding them", async () => {
    const { container, instance, settle } = await getDOM<Board>(<Board />);

    const first = (
      container.querySelectorAll("li")[0] as unknown as {
        _componentInstance: Row;
      }
    )._componentInstance;
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
    const third = (
      container.querySelectorAll("li")[2] as unknown as {
        _componentInstance: Row;
      }
    )._componentInstance;
    third.clicks = 9;
    await settle();

    instance.tasks = [instance.tasks[0], instance.tasks[2]];
    await settle();

    // Position matching would have given "c" the middle row's state.
    expect(texts(container)).toEqual(["a:0", "c:9"]);
  });

  test("the same item twice gets its own row each time", async () => {
    const tag: Task = { title: "tag" };

    @Host("div")
    class Twice extends Component {
      @state tasks: Task[] = [tag, tag];
      render() {
        return <ul>{list({ each: this.tasks, as: Row })}</ul>;
      }
    }

    const { container, settle } = await getDOM(<Twice />);
    const rows = container.querySelectorAll("li");
    expect(rows.length).toBe(2);

    (rows[0] as unknown as { _componentInstance: Row })._componentInstance.clicks = 3;
    await settle();

    // Reference identity cannot tell two occurrences apart, and neither could a
    // hand-written key — the engine mints one id per occurrence.
    expect(texts(container)).toEqual(["tag:3", "tag:0"]);
  });

  test("`key` overrides identity for objects re-created per fetch", async () => {
    @Host("div")
    class Refetching extends Component {
      @state tasks = [
        { id: "1", title: "a" },
        { id: "2", title: "b" },
      ];
      render() {
        return (
          <ul>
            {list({
              each: this.tasks,
              key: (task: { id: string; title: string }) => task.id,
              render: (task: { id: string; title: string }) => <li>{task.title}</li>,
            })}
          </ul>
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
    // Without `key` these would be unrecognised items and every node rebuilt.
    expect([...container.querySelectorAll("li")].filter((n) => before.includes(n)).length).toBe(2);
  });

  test("a colliding `key` callback is reported", async () => {
    // `key` is the ONE place a mistake is still possible — minted identity
    // cannot collide, a hand-written one can — so it must not pass unnoticed.
    const codes: string[] = [];
    const messages: string[] = [];
    const handler = (event: Event) => {
      const message = (event as CustomEvent).detail?.message as string;
      const code = message?.match(/^\[(RMD\d+)\]/)?.[1];
      if (code) {
        codes.push(code);
        messages.push(message);
      }
    };
    window.addEventListener("ramonda:dev-log", handler);

    try {
      @Host("div")
      class Bad extends Component {
        @state tasks: Task[] = [{ title: "a" }, { title: "b" }];
        render() {
          return <ul>{list({ each: this.tasks, key: () => "same", as: Row })}</ul>;
        }
      }

      await getDOM<Bad>(<Bad />);

      expect(codes).toContain("RMD013");
      expect(messages.join("\n")).toContain("more than one item");
    } finally {
      window.removeEventListener("ramonda:dev-log", handler);
    }
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
      @Host("div")
      class Pages extends Component {
        @state pages: Task[][] = [[{ title: "a" }], [{ title: "b" }]];
        render() {
          return <ul>{list({ each: this.pages, render: this.page })}</ul>;
        }
        // Cast: this is exactly what the types reject, and the point is what the
        // RUNTIME does with it — a JavaScript app has no such guard.
        private page(rows: Task[]): VNode {
          return list({ each: rows, as: Row }) as unknown as VNode;
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

    @Host("div")
    class Panel extends Component {
      @state open = false;
      @state tasks: Task[] = [{ title: "a" }];

      render() {
        if (!this.open) return <p>closed</p>;
        return (
          <ul>
            {list({
              each: this.tasks,
              render: (task: Task) => {
                mapperRuns++;
                return <li>{task.title}</li>;
              },
            })}
          </ul>
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
    @Host("div")
    class Two extends Component {
      @state todo: Task[] = [{ title: "t1" }, { title: "t2" }];
      @state done: Task[] = [{ title: "d1" }];

      render() {
        return (
          <div>
            <ul id="todo">{list({ each: this.todo, as: Row })}</ul>
            <ul id="done">{list({ each: this.done, as: Row })}</ul>
          </div>
        );
      }
    }

    const { container, instance, settle } = await getDOM<Two>(<Two />);
    const todoRow = (
      container.querySelector("#todo li") as unknown as {
        _componentInstance: Row;
      }
    )._componentInstance;
    todoRow.clicks = 4;
    await settle();

    instance.done = [...instance.done, { title: "d2" }];
    await settle();

    // Both lists mint `f0`, `f1` — the regions are what keeps them apart.
    expect(texts(container.querySelector("#todo")!)).toEqual(["t1:4", "t2:0"]);
    expect(texts(container.querySelector("#done")!)).toEqual(["d1:0", "d2:0"]);
  });

  test("a list beside ordinary siblings does not claim them", async () => {
    @Host("div")
    class WithChrome extends Component {
      @state tasks: Task[] = [{ title: "a" }];
      render() {
        return (
          <ul>
            <li id="head">HEAD</li>
            {list({ each: this.tasks, as: Row })}
            <li id="foot">FOOT</li>
          </ul>
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
    @Host("div")
    class Shifting extends Component {
      @state showFirst = true;
      @state a: Task[] = [{ title: "a" }];
      @state b: Task[] = [{ title: "b" }];

      render() {
        return (
          <ul>
            {this.showFirst ? list({ each: this.a, as: Row }) : null}
            {list({ each: this.b, as: Row })}
          </ul>
        );
      }
    }

    const { container, instance, settle } = await getDOM<Shifting>(<Shifting />);
    const bRow = (
      container.querySelectorAll("li")[1] as unknown as {
        _componentInstance: Row;
      }
    )._componentInstance;
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

    @Host("li")
    class GroupRow extends Component<{ item: Group }> {
      render() {
        return (
          <ul>
            {list({
              each: this.props.item.items,
              render: (task: Task) => <li>{task.title}</li>,
            })}
          </ul>
        );
      }
    }

    @Host("div")
    class Nested extends Component {
      @state groups: Group[] = [
        { name: "g1", items: [{ title: "a" }, { title: "b" }] },
        { name: "g2", items: [{ title: "c" }] },
      ];
      render() {
        return <ul>{list({ each: this.groups, as: GroupRow })}</ul>;
      }
    }

    const { container, instance, settle } = await getDOM<Nested>(<Nested />);
    expect(container.textContent).toBe("abc");

    instance.groups = [...instance.groups].reverse();
    await settle();
    expect(container.textContent).toBe("cab");
  });

  test("two lists in DIFFERENT elements keep their own identity", async () => {
    @Host("div")
    class Split extends Component {
      @state left: Task[] = [{ title: "l1" }];
      @state right: Task[] = [{ title: "r1" }];

      render() {
        return (
          <div>
            <ul id="left">{list({ each: this.left, as: Row })}</ul>
            <ul id="right">{list({ each: this.right, as: Row })}</ul>
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

    @Host("div")
    class Board extends Component {
      @state unrelated = 0;
      @state tasks: Task[] = [{ title: "a" }, { title: "b" }];

      render() {
        return (
          <div>
            <p>{this.unrelated}</p>
            <ul>
              {list({
                each: this.tasks,
                render: (task: Task) => {
                  mapperRuns++;
                  return <li>{task.title}</li>;
                },
              })}
            </ul>
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
  @Host("div")
  class Board extends Component {
    @state tasks: Task[] = [{ title: "a" }, { title: "b" }, { title: "c" }];
    render() {
      return <ul>{list({ each: this.tasks, as: Row })}</ul>;
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

    const instance = (element.firstChild as unknown as { _componentInstance: Board })._componentInstance;
    const first = (
      element.querySelectorAll("li")[0] as unknown as {
        _componentInstance: Row;
      }
    )._componentInstance;
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

  @Host("td")
  class CellView extends Component<{ item: Cell }> {
    @state clicks = 0;
    render() {
      return (
        <span>
          {this.props.item.label}:{this.clicks}
        </span>
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
  @Host("table")
  class Grid extends Component {
    @state rows: GridRow[] = [
      { name: "r1", cells: [{ label: "a" }, { label: "b" }] },
      { name: "r2", cells: [{ label: "c" }, { label: "d" }] },
    ];

    render() {
      return (
        <tbody>
          {list({
            each: this.rows,
            // `key` on the OUTER list, and in two dimensions it is close to
            // mandatory — see "the trap" below. Changing anything inside a row
            // means producing a new row OBJECT, which reference identity reads
            // as a different row.
            key: (row: GridRow) => row.name,
            render: (row: GridRow) => <tr>{list({ each: row.cells, as: CellView })}</tr>,
          })}
        </tbody>
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
    const cell = (
      container.querySelectorAll("td")[0] as unknown as {
        _componentInstance: CellView;
      }
    )._componentInstance;
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

  test("the trap: without `key`, editing a row's cells rebuilds the row", async () => {
    // Worth pinning, because it is the first thing anyone hits in 2D and the
    // behaviour is correct rather than buggy. An immutable update to the inner
    // array necessarily produces a NEW outer object, and the outer list
    // identifies rows by reference — so it is a different row, and its whole
    // subtree goes with it.
    @Host("table")
    class Unkeyed extends Component {
      @state rows: GridRow[] = [{ name: "r1", cells: [{ label: "a" }, { label: "b" }] }];
      render() {
        return (
          <tbody>
            {list({
              each: this.rows,
              render: (row: GridRow) => <tr>{list({ each: row.cells, as: CellView })}</tr>,
            })}
          </tbody>
        );
      }
    }

    const { container, instance, settle } = await getDOM<Unkeyed>(<Unkeyed />);
    const cell = (
      container.querySelectorAll("td")[0] as unknown as {
        _componentInstance: CellView;
      }
    )._componentInstance;
    cell.clicks = 3;
    await settle();
    expect(grid(container)[0]).toEqual(["a:3", "b:0"]);

    const first = instance.rows[0];
    instance.rows = [{ ...first, cells: [...first.cells].reverse() }];
    await settle();

    // The cells moved, but the row is a new object, so the row was rebuilt and
    // the cell state went with the old one. Add `key: (row) => row.name` and the
    // next test shows what happens instead.
    expect(grid(container)[0]).toEqual(["b:0", "a:0"]);
  });

  test("with `key`, reordering CELLS moves them with their state", async () => {
    const { container, instance, settle } = await getDOM<Grid>(<Grid />);

    const second = (
      container.querySelectorAll("td")[1] as unknown as {
        _componentInstance: CellView;
      }
    )._componentInstance;
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

    const firstOfRowTwo = (
      container.querySelectorAll("tr")[1].querySelectorAll("td")[0] as unknown as { _componentInstance: CellView }
    )._componentInstance;
    firstOfRowTwo.clicks = 2;
    await settle();

    expect(grid(container)).toEqual([
      ["a:0", "b:0"],
      ["c:2", "d:0"],
    ]);
  });

  test("a ragged array works, and a row can empty out", async () => {
    @Host("table")
    class Ragged extends Component {
      @state rows: Cell[][] = [[{ label: "a" }, { label: "b" }], [{ label: "c" }], []];
      render() {
        return (
          <tbody>
            {list({
              each: this.rows,
              render: (cells: Cell[]) => <tr>{list({ each: cells, as: CellView })}</tr>,
            })}
          </tbody>
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

  @Host("td")
  class Cell2View extends Component<{ item: Cell2 }> {
    @state clicks = 0;
    render() {
      return (
        <span>
          {this.props.item.label}:{this.clicks}
        </span>
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
  @Host("tr")
  class OwningRow extends Component<{ item: { name: string; cells: Cell2[] } }> {
    @state cells: Cell2[] = this.props.item.cells;

    reverse() {
      this.cells = [...this.cells].reverse();
    }

    render() {
      // A list returned STRAIGHT from render(), with no element around it.
      return list({ each: this.cells, as: Cell2View });
    }
  }

  @Host("table")
  class Sheet extends Component {
    @state rows = [
      { name: "r1", cells: [{ label: "a" }, { label: "b" }] },
      { name: "r2", cells: [{ label: "c" }] },
    ];
    render() {
      return <tbody>{list({ each: this.rows, as: OwningRow })}</tbody>;
    }
  }

  test("editing a row's cells keeps their state, with no key anywhere", async () => {
    const { container, settle } = await getDOM(<Sheet />);
    expect(grid2(container)).toEqual([["a:0", "b:0"], ["c:0"]]);

    const cell = (
      container.querySelectorAll("td")[0] as unknown as {
        _componentInstance: Cell2View;
      }
    )._componentInstance;
    cell.clicks = 3;
    await settle();

    const row = (
      container.querySelector("tr") as unknown as {
        _componentInstance: OwningRow;
      }
    )._componentInstance;
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

    const row = (
      container.querySelector("tr") as unknown as {
        _componentInstance: OwningRow;
      }
    )._componentInstance;
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

  @Host("td")
  class Cell3View extends Component<{ item: Cell3 }> {
    render() {
      return <span>{this.props.item.label}</span>;
    }
  }

  /**
   * `@state cells = this.props.item.cells` makes the ROW the owner of that data.
   *
   * That is what removes the need for a key — but it is the classic
   * derived-state-from-props trade, and it has to be stated: the field is seeded
   * ONCE, at construction, so the parent can no longer push anything into it.
   * Measured below: the parent adds a cell and the row does not see it, even
   * though `key` kept the row alive.
   *
   * So "no keys in 2D" is an architectural choice, not a trick. It is right when
   * a row genuinely owns its rows-worth of data and edits are local. It is wrong
   * the moment the parent is the source of truth.
   */
  @Host("tr")
  class OwningRow3 extends Component<{ item: Row3 }> {
    @state cells: Cell3[] = this.props.item.cells;
    render() {
      return list({ each: this.cells, as: Cell3View });
    }
  }

  /** The other shape: the row reads through, and the parent stays in charge. */
  @Host("tr")
  class PropsRow3 extends Component<{ item: Row3 }> {
    render() {
      return list({ each: this.props.item.cells, as: Cell3View });
    }
  }

  function sheetOf(RowComp: typeof OwningRow3 | typeof PropsRow3) {
    @Host("table")
    class Sheet extends Component {
      @state rows: Row3[] = [{ name: "r1", cells: [{ label: "a" }] }];
      render() {
        return (
          <tbody>
            {list({
              each: this.rows,
              key: (row: Row3) => row.name,
              as: RowComp as typeof OwningRow3,
            })}
          </tbody>
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

  @Host("td")
  class Cell4View extends Component<{ item: Cell4 }> {
    @state clicks = 0;
    render() {
      return (
        <span>
          {this.props.item.label}:{this.clicks}
        </span>
      );
    }
  }

  /** No `key` anywhere — the question is what that costs, not whether it works. */
  @Host("table")
  class Unkeyed extends Component {
    @state rows: Row4[] = [
      { name: "r1", cells: [{ label: "a" }, { label: "b" }] },
      { name: "r2", cells: [{ label: "c" }, { label: "d" }] },
    ];
    render() {
      return (
        <tbody>
          {list({
            each: this.rows,
            render: (row: Row4) => <tr>{list({ each: row.cells, as: Cell4View })}</tr>,
          })}
        </tbody>
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
      (td as unknown as { _componentInstance: Cell4View })._componentInstance.clicks = i + 1;
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
