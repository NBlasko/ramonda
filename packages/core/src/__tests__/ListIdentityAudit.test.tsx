import { describe, test, expect, beforeEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, list, state } from "../index";
import { created, destroyed, Host as HostDec } from "../base/decorators";

/**
 * Every operation people actually perform on an array, measured — the contract
 * for `itemIdentity.ts`.
 *
 * ## Why this file exists rather than more unit tests
 *
 * `list()` decides which row is which by INFERENCE: what two rows still have in
 * common, weighted by how much each field distinguishes them. That mechanism was
 * wrong four separate times while it was being built, and **not one of those was
 * found by reasoning about it**. Each came out of running a table like this one:
 *
 * - the array ENDS acted as anchors, so with nothing value-equal the whole thing
 *   degenerated to matching by position, and page 2 of a table took page 1's rows;
 * - a run between anchors paired first-with-first, so a BRAND NEW row took the
 *   identity of the row above it while the row that had merely changed got a
 *   fresh one — precisely inverted;
 * - a shared flag (`done: false`, which every row of real data carries) counted as
 *   evidence, so two unrelated pages paired anyway;
 * - a field equal to its own index was DISCARDED to stop a form row's `index`
 *   outvoting its `id` — which threw away the only identity `items.map((x, i) =>
 *   ({ id: i }))` has.
 *
 * Every one of those was silent. A list that quietly rebuilds a row loses whatever
 * that row's component was holding — a half-typed input, an open menu, a scroll
 * position — and the page still looks right.
 *
 * So: any change to the identity rules re-runs this. If a row here moves, that is
 * the change asking to be justified, not a fixture to update.
 *
 * ## What is measured
 *
 * One row is marked with state its component owns, and the assertion is that the
 * state stays on THAT ENTITY through the operation — plus how many components were
 * created and destroyed, which is what a rebuild actually costs.
 *
 * ```
 *   operation                        kept   created  destroyed   state
 *   filter (remove one)              3/3       0         1       stays
 *   immutable edit of one            4/4       0         0       stays
 *   immutable edit of ALL            4/4       0         0       stays
 *   sort/reverse (same refs)         4/4       0         0       stays
 *   append                           4/5       1         0       stays
 *   prepend                          4/5       1         0       stays
 *   splice out the first             3/3       0         1       stays
 *   refetch, identical data          4/4       0         0       stays
 *   refetch, one row changed         4/4       0         0       stays
 *   refetch, every row changed       4/4       0         0       stays
 *   page 2 (different entities)      0/2       2         4       GONE — correct
 *   infinite scroll append           4/6       2         0       stays
 *   fresh array, same objects        4/4       0         0       stays
 *   slice (windowing)                2/2       0         2       stays
 * ```
 *
 * The one place state is deliberately lost is page 2: those are different
 * entities, and carrying a half-typed draft onto one of them is the failure this
 * whole mechanism exists to avoid.
 */

interface Row {
  id: number;
  title: string;
  /** A flag every row shares. Real rows have these, and they must not count as identity. */
  done: boolean;
}

let creates = 0;
let destroys = 0;

beforeEach(() => {
  creates = 0;
  destroys = 0;
});

@HostDec("li")
class RowView extends Component<{ item: Row }> {
  /** Stands in for anything a row holds: a half-typed input, an open menu. */
  @state draft = "";

  @created
  c(): void {
    creates++;
  }

  @destroyed
  d(): void {
    destroys++;
  }

  render() {
    return <span data-draft={this.draft}>{this.props.item.title}</span>;
  }
}

@Host("div")
class App extends Component {
  @state rows: Row[] = [
    { id: 1, title: "a", done: false },
    { id: 2, title: "b", done: false },
    { id: 3, title: "c", done: false },
    { id: 4, title: "d", done: false },
  ];
  render() {
    return <ul>{list(this.rows, (item) => <RowView item={item} />)}</ul>;
  }
}

const MARK = "typing";

/** Runs one operation against a fresh app, with row 1 ("b") holding state. */
async function operate(op: (rows: Row[]) => Row[]) {
  const app = await getDOM<App>(<App />);
  await app.settle();

  const before = [...app.container.querySelectorAll("li")];
  (before[1] as unknown as { _componentInstance: RowView })._componentInstance.draft = MARK;
  await app.settle();

  creates = 0;
  destroys = 0;
  app.instance.rows = op(app.instance.rows);
  await app.settle();

  const after = [...app.container.querySelectorAll("li")];
  const marked = after.find((li) => li.querySelector("span")?.getAttribute("data-draft") === MARK);
  return {
    kept: after.filter((node) => before.includes(node)).length,
    total: after.length,
    creates,
    destroys,
    /** The title of the row the state ended up on, or undefined if it was lost. */
    stateOn: marked?.textContent,
    titles: after.map((li) => li.textContent).join(","),
  };
}

describe("what every array operation costs a list", () => {
  test("filter (remove one)", async () => {
    const r = await operate((rows) => rows.filter((row) => row.id !== 3));
    expect(r).toMatchObject({ kept: 3, total: 3, creates: 0, destroys: 1, stateOn: "b" });
  });

  test("immutable edit of one row", async () => {
    const r = await operate((rows) => rows.map((row) => (row.id === 3 ? { ...row, done: true } : row)));
    expect(r).toMatchObject({ kept: 4, total: 4, creates: 0, destroys: 0, stateOn: "b" });
  });

  test("immutable edit of EVERY row", async () => {
    // The case a `.map` over a whole grid produces. Every row object is new.
    const r = await operate((rows) => rows.map((row) => ({ ...row, done: true })));
    expect(r).toMatchObject({ kept: 4, total: 4, creates: 0, destroys: 0, stateOn: "b" });
  });

  test("sort or reverse, references kept", async () => {
    const r = await operate((rows) => [...rows].reverse());
    expect(r).toMatchObject({ kept: 4, total: 4, creates: 0, destroys: 0, stateOn: "b", titles: "d,c,b,a" });
  });

  test("append", async () => {
    const r = await operate((rows) => [...rows, { id: 5, title: "e", done: false }]);
    expect(r).toMatchObject({ kept: 4, total: 5, creates: 1, destroys: 0, stateOn: "b" });
  });

  test("prepend", async () => {
    const r = await operate((rows) => [{ id: 0, title: "z", done: false }, ...rows]);
    expect(r).toMatchObject({ kept: 4, total: 5, creates: 1, destroys: 0, stateOn: "b" });
  });

  test("splice out the first row", async () => {
    const r = await operate((rows) => rows.slice(1));
    expect(r).toMatchObject({ kept: 3, total: 3, creates: 0, destroys: 1, stateOn: "b" });
  });

  test("refetch that returned identical data", async () => {
    const r = await operate((rows) => rows.map((row) => ({ ...row })));
    expect(r).toMatchObject({ kept: 4, total: 4, creates: 0, destroys: 0, stateOn: "b" });
  });

  test("refetch in which one row changed", async () => {
    const r = await operate((rows) => rows.map((row) => ({ ...row, title: row.id === 2 ? "b2" : row.title })));
    expect(r).toMatchObject({ kept: 4, total: 4, creates: 0, destroys: 0, stateOn: "b2" });
  });

  test("refetch in which EVERY row changed", async () => {
    const r = await operate((rows) => rows.map((row) => ({ ...row, title: `${row.title}!` })));
    expect(r).toMatchObject({ kept: 4, total: 4, creates: 0, destroys: 0, stateOn: "b!" });
  });

  test("page 2 — different entities inherit nothing", async () => {
    // The one operation where losing the state is CORRECT. These are not the same
    // rows, and carrying a half-typed draft onto one of them is the failure the
    // whole mechanism exists to avoid. Note the rows still share `done: false`,
    // which is exactly what fooled an earlier version.
    const r = await operate(() => [
      { id: 90, title: "x", done: false },
      { id: 91, title: "y", done: false },
    ]);
    expect(r).toMatchObject({ kept: 0, total: 2, creates: 2, destroys: 4, stateOn: undefined });
  });

  test("infinite scroll — a page appended", async () => {
    const r = await operate((rows) => [
      ...rows,
      { id: 5, title: "e", done: false },
      { id: 6, title: "f", done: false },
    ]);
    expect(r).toMatchObject({ kept: 4, total: 6, creates: 2, destroys: 0, stateOn: "b" });
  });

  test("a fresh array holding the same objects", async () => {
    const r = await operate((rows) => [...rows]);
    expect(r).toMatchObject({ kept: 4, total: 4, creates: 0, destroys: 0, stateOn: "b" });
  });

  test("slice — a window over the rows", async () => {
    const r = await operate((rows) => rows.slice(1, 3));
    expect(r).toMatchObject({ kept: 2, total: 2, creates: 0, destroys: 2, stateOn: "b" });
  });
});

/**
 * The same question one level down.
 *
 * Nesting was the case most likely to break and does not: each level aligns its
 * own array, so a row that keeps its identity keeps its region, and the cells are
 * then aligned inside it. `valueEqual` is bounded at depth 2 and fails towards
 * "different", so a deep change never produces a false anchor — it falls through
 * to the overlap pairing, which the row's own id settles.
 */
describe("two dimensions", () => {
  interface Cell {
    id: number;
    label: string;
    done: boolean;
  }
  interface GridRow {
    id: number;
    name: string;
    done: boolean;
    cells: Cell[];
  }

  let cellCreates = 0;
  let cellDestroys = 0;

  @HostDec("td")
  class CellView extends Component<{ item: Cell }> {
    @state draft = "";

    @created
    c(): void {
      cellCreates++;
    }

    @destroyed
    d(): void {
      cellDestroys++;
    }

    render() {
      return <span data-draft={this.draft}>{this.props.item.label}</span>;
    }
  }

  @Host("table")
  class Grid extends Component {
    @state rows: GridRow[] = [
      { id: 1, name: "r1", done: false, cells: [{ id: 11, label: "a", done: false }, { id: 12, label: "b", done: false }] },
      { id: 2, name: "r2", done: false, cells: [{ id: 21, label: "c", done: false }, { id: 22, label: "d", done: false }] },
    ];
    render() {
      return <tbody>{list(this.rows, (row: GridRow) => <tr>{list(row.cells, (item) => <CellView item={item} />)}</tr>)}</tbody>;
    }
  }

  /** Marks the LAST cell — the deepest thing that could be lost. */
  async function operateGrid(op: (rows: GridRow[]) => GridRow[]) {
    const app = await getDOM<Grid>(<Grid />);
    await app.settle();

    const before = [...app.container.querySelectorAll("td")];
    (before[3] as unknown as { _componentInstance: CellView })._componentInstance.draft = MARK;
    await app.settle();

    cellCreates = 0;
    cellDestroys = 0;
    app.instance.rows = op(app.instance.rows);
    await app.settle();

    const after = [...app.container.querySelectorAll("td")];
    const marked = after.find((td) => td.querySelector("span")?.getAttribute("data-draft") === MARK);
    return {
      kept: after.filter((node) => before.includes(node)).length,
      total: after.length,
      creates: cellCreates,
      destroys: cellDestroys,
      stateOn: marked?.textContent,
    };
  }

  const roundTrip = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

  test("a refetch of the whole grid keeps every cell", async () => {
    // Every object at both levels is new, and nothing is lost.
    const r = await operateGrid(roundTrip);
    expect(r).toMatchObject({ kept: 4, total: 4, creates: 0, destroys: 0, stateOn: "d" });
  });

  test("editing one cell touches one cell", async () => {
    const r = await operateGrid((rows) =>
      rows.map((row) =>
        row.id !== 2 ? row : { ...row, cells: row.cells.map((c) => (c.id === 21 ? { ...c, label: "C!" } : c)) },
      ),
    );
    expect(r).toMatchObject({ kept: 4, total: 4, creates: 0, destroys: 0, stateOn: "d" });
  });

  test("reordering rows carries their cells", async () => {
    const r = await operateGrid((rows) => [...rows].reverse());
    expect(r).toMatchObject({ kept: 4, total: 4, creates: 0, destroys: 0, stateOn: "d" });
  });

  test("reordering cells within a row", async () => {
    const r = await operateGrid((rows) =>
      rows.map((row) => (row.id !== 2 ? row : { ...row, cells: [...row.cells].reverse() })),
    );
    expect(r).toMatchObject({ kept: 4, total: 4, creates: 0, destroys: 0, stateOn: "d" });
  });

  test("adding a column to every row", async () => {
    // Every ROW object changes, which is what made an earlier version rebuild the
    // lot and cost every cell its state.
    const r = await operateGrid((rows) =>
      rows.map((row) => ({ ...row, cells: [...row.cells, { id: row.id * 10 + 9, label: "new", done: false }] })),
    );
    expect(r).toMatchObject({ kept: 4, total: 6, creates: 2, destroys: 0, stateOn: "d" });
  });

  test("removing the first row", async () => {
    const r = await operateGrid((rows) => rows.slice(1));
    expect(r).toMatchObject({ kept: 2, total: 2, creates: 0, destroys: 2, stateOn: "d" });
  });

  test("a refetch whose only change is deep", async () => {
    const r = await operateGrid((rows) => {
      const copy = roundTrip(rows);
      copy[1].cells[0].label = "C!";
      return copy;
    });
    expect(r).toMatchObject({ kept: 4, total: 4, creates: 0, destroys: 0, stateOn: "d" });
  });

  test("a different grid inherits nothing", async () => {
    const r = await operateGrid(() => [
      { id: 90, name: "x", done: false, cells: [{ id: 91, label: "z", done: false }] },
    ]);
    expect(r).toMatchObject({ kept: 0, total: 1, creates: 1, destroys: 4, stateOn: undefined });
  });
});
