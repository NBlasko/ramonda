import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, list, state } from "../index";

/**
 * A performance invariant, not a behaviour one — so it is asserted in DOM moves
 * rather than in milliseconds, which would be flaky.
 *
 * `mountNode` appends new children at the END, so before the minimal reorder a
 * single insertion near the front made every node after it look misplaced and
 * each got its own `insertBefore`. At 10000 items that measured 38.9s. These
 * lists are small enough to stay fast either way; what they lock is the COUNT.
 * See BUGS.md — "Inserting one item near the front of a long list".
 */

interface Row {
  id: number;
}

@Host("li")
class Item extends Component<{ row: Row }> {
  render() {
    return <span>{this.props.row.id}</span>;
  }
}

const SIZE = 200;

function countMoves(parent: Element) {
  let moves = 0;
  const original = parent.insertBefore.bind(parent);
  (parent as unknown as { insertBefore: unknown }).insertBefore = (a: Node, b: Node | null) => {
    moves++;
    return original(a, b);
  };
  return () => moves;
}

@Host("div")
class List extends Component {
  @state rows: Row[] = Array.from({ length: SIZE }, (_, i) => ({ id: i }));
  render() {
    return <ul>{list({ each: this.rows, render: (row: Row) => <Item row={row} /> })}</ul>;
  }
}

describe("reorder moves the fewest nodes it can", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("inserting at the front costs one DOM move, not SIZE of them", async () => {
    const app = await getDOM<List>(<List />);
    await app.settle();

    const moves = countMoves(app.container.querySelector("ul")!);
    app.instance.rows = [{ id: -1 }, ...app.instance.rows];
    await app.settle();

    // Before the fix this was SIZE (199 nodes dragged past the appended one).
    expect(moves()).toBe(1);
    const first = app.container.querySelector("li span")!;
    expect(first.textContent).toBe("-1");
  });

  test("a no-op render moves nothing at all", async () => {
    const app = await getDOM<List>(<List />);
    await app.settle();

    const moves = countMoves(app.container.querySelector("ul")!);
    // Same items, new array: the list rebuilds every vnode but nothing moved.
    app.instance.rows = app.instance.rows.slice();
    await app.settle();

    expect(moves()).toBe(0);
  });

  test("moving one item to the front costs one move", async () => {
    const app = await getDOM<List>(<List />);
    await app.settle();

    const moves = countMoves(app.container.querySelector("ul")!);
    const rows = app.instance.rows.slice();
    const [taken] = rows.splice(SIZE - 1, 1);
    app.instance.rows = [taken, ...rows];
    await app.settle();

    expect(moves()).toBe(1);
    expect(app.container.querySelector("li span")!.textContent).toBe(String(SIZE - 1));
  });
});
