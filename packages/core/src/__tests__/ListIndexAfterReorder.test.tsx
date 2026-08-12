import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, list, state } from "../index";

/**
 * `index` in `render: (item, index) => …` against the per-item clean-skip.
 *
 * The skip is the reason a list is fast: an item whose object is unchanged and
 * whose signals are untouched reuses last render's vnode, and the diff does not
 * walk its subtree. But an item's INDEX is not part of the item — it is the
 * item's position in `each`, and a reorder changes it while changing nothing the
 * skip looks at. The vnode that comes back was then built at the old position, so
 * a `render` that displays the index displays a stale one.
 *
 * The fix cannot be "always rebuild on a reorder": that would hand every list the
 * cost of the one that reads the index. So the engine reuses the vnode unless the
 * callback can actually observe the position — which is what these tests pin, in
 * both directions:
 *
 *  - a `render` that takes an index follows the item as it moves;
 *  - a `render` that does not still skips, with the mapper never called.
 *
 * `as` components take no index and are unaffected either way.
 */

interface Row {
  id: number;
  name: string;
}

const rowsOf = (container: Element) => Array.from(container.querySelectorAll("li")).map((li) => li.textContent);

describe("list() index after a reorder", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("the index follows the item to its new position", async () => {
    @Host("ul")
    class L extends Component {
      @state rows: Row[] = [
        { id: 1, name: "a" },
        { id: 2, name: "b" },
        { id: 3, name: "c" },
      ];

      render() {
        return list(this.rows, (r: Row, i: number) => <li>{`${i}:${r.name}`}</li>);
      }
    }

    const app = await getDOM<L>(<L />);
    await app.settle();
    expect(rowsOf(app.container)).toEqual(["0:a", "1:b", "2:c"]);

    // The SAME objects in a new order: every scope is clean, so without an index
    // check each row keeps the vnode built at its old position.
    const [a, b, c] = app.instance.rows;
    app.instance.rows = [c, b, a];
    await app.settle();

    expect(rowsOf(app.container)).toEqual(["0:c", "1:b", "2:a"]);
  });

  test("an item that keeps its position is not rebuilt", async () => {
    let mapperCalls = 0;

    @Host("ul")
    class L extends Component {
      @state rows: Row[] = [
        { id: 1, name: "a" },
        { id: 2, name: "b" },
      ];

      render() {
        return list(this.rows, (r: Row, i: number) => {
            mapperCalls++;
            return <li>{`${i}:${r.name}`}</li>;
          });
      }
    }

    const app = await getDOM<L>(<L />);
    await app.settle();

    // Appending moves nobody: the two existing rows keep both their object and
    // their index, so only the new row runs the mapper. The index check must not
    // turn "the array was replaced" into "rebuild everything".
    mapperCalls = 0;
    app.instance.rows = [...app.instance.rows, { id: 3, name: "c" }];
    await app.settle();

    expect(mapperCalls).toBe(1);
    expect(rowsOf(app.container)).toEqual(["0:a", "1:b", "2:c"]);

    // Prepending moves both of them, and both are rebuilt — the cost the index
    // asks for, paid only by the rows whose position actually changed.
    mapperCalls = 0;
    app.instance.rows = [{ id: 0, name: "z" }, ...app.instance.rows];
    await app.settle();

    expect(mapperCalls).toBe(4);
    expect(rowsOf(app.container)).toEqual(["0:z", "1:a", "2:b", "3:c"]);
  });

  test("a render that ignores the index keeps its clean-skip across a reorder", async () => {
    let mapperCalls = 0;

    @Host("ul")
    class L extends Component {
      @state rows: Row[] = [
        { id: 1, name: "a" },
        { id: 2, name: "b" },
        { id: 3, name: "c" },
      ];

      render() {
        // One parameter: the position is not observable, so moving a row can
        // never change what this produces.
        return list(this.rows, (r: Row) => {
          mapperCalls++;
          return <li>{r.name}</li>;
        });
      }
    }

    const app = await getDOM<L>(<L />);
    await app.settle();

    mapperCalls = 0;
    const [a, b, c] = app.instance.rows;
    app.instance.rows = [c, b, a];
    await app.settle();

    // Reordered in the DOM without running the mapper once.
    expect(mapperCalls).toBe(0);
    expect(rowsOf(app.container)).toEqual(["c", "b", "a"]);
  });
});
