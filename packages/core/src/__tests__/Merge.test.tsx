import { describe, test, expect } from "vitest";
import { getDOM } from "../test/setup";
import { Component, list, state, merge } from "../index";
import { mounted } from "../base/decorators";

/**
 * `merge()` — structural sharing, and the one place an app can state what only it
 * knows about its rows.
 *
 * `list()` infers identity, and for the shapes real data takes it is right. But it
 * is inference: it reads what two rows still have in common and decides. Rows that
 * share nothing identifying — no primitive field, or a frozen object it cannot
 * write to — cannot be paired at all, and there was no way to tell it otherwise.
 *
 * `merge` is that way, and it sits at the DATA boundary rather than on the list.
 * The identity is said once, where the rows arrive, instead of on every list that
 * renders them.
 */

interface Row {
  id: number;
  title: string;
  done: boolean;
}

const rows = (): Row[] => [
  { id: 1, title: "a", done: false },
  { id: 2, title: "b", done: false },
  { id: 3, title: "c", done: false },
];

describe("merge shares what did not change", () => {
  test("an equal value comes back as the PREVIOUS one", () => {
    const before = rows();
    const after = merge(before, rows());
    expect(after).toBe(before);
  });

  test("a changed row keeps every other row's identity", () => {
    const before = rows();
    const incoming = rows();
    incoming[1] = { id: 2, title: "B!", done: false };

    const after = merge(before, incoming);
    expect(after).not.toBe(before);
    expect(after[0]).toBe(before[0]);
    expect(after[2]).toBe(before[2]);
    expect(after[1].title).toBe("B!");
  });

  test("without an identity, a different length is simply the new value", () => {
    // The positional walk has nothing to match rows by once the positions stop
    // lining up. `list()` does that downstream, with more to go on than this has.
    const before = rows();
    const incoming = rows().slice(0, 2);
    expect(merge(before, incoming)).toBe(incoming);
  });
});

describe("merge with an identity", () => {
  const byId = (row: unknown) => (row as Row).id;

  test("a reordered array still shares every row", () => {
    const before = rows();
    const incoming = [rows()[2], rows()[0], rows()[1]];

    const after = merge(before, incoming, byId);
    expect(after[0]).toBe(before[2]);
    expect(after[1]).toBe(before[0]);
    expect(after[2]).toBe(before[1]);
  });

  test("adding a row keeps the rows that were there", () => {
    const before = rows();
    const after = merge(before, [...rows(), { id: 4, title: "d", done: false }], byId);

    expect(after).toHaveLength(4);
    for (let i = 0; i < 3; i++) expect(after[i]).toBe(before[i]);
    expect(after[3].id).toBe(4);
  });

  test("removing a row keeps the survivors", () => {
    const before = rows();
    const after = merge(before, [rows()[0], rows()[2]], byId);

    expect(after).toHaveLength(2);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[2]);
  });

  test("a duplicate identity is not pinned onto two rows", () => {
    // The app contradicted itself. Pairing one of the two arbitrarily would put
    // one row's state on the other, so the second is treated as a row this has
    // not seen.
    const before = rows();
    const after = merge(
      before,
      [
        { id: 1, title: "a", done: false },
        { id: 1, title: "x", done: false },
      ],
      byId,
    );

    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[0]);
  });

  test("an item with no identity falls back to the positional walk", () => {
    // A nested array of primitives, or rows of a shape the callback does not
    // recognise. Degrading is the point: it must not misbehave.
    const before = [1, 2, 3];
    expect(merge(before, [1, 2, 3], () => undefined)).toBe(before);
  });
});

describe("merge carries identity where inference cannot", () => {
  let mounts = 0;

  class RowView extends Component<{ item: Row }> {
    @state draft = "";

    @mounted
    count(): void {
      mounts++;
    }

    render() {
      return (
        <li>
          <span data-draft={this.draft}>{this.props.item.title}</span>
        </li>
      );
    }
  }

  test("a row with nothing to identify it survives a refetch", async () => {
    // Rows whose only content is nested: there is no primitive field to pair on,
    // so `list()` rebuilds the row that changed and whatever its component held
    // goes with it. Measured before this: the half-typed draft was lost.
    interface Bag {
      tags: string[];
    }

    class App extends Component {
      @state bags: Bag[] = [{ tags: ["a"] }, { tags: ["b"] }];
      render() {
        return (
          <div>
            <ul>
              {list(this.bags, (b: Bag) => (
                <li>{b.tags.join(",")}</li>
              ))}
            </ul>
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();
    const before = [...app.container.querySelectorAll("li")];

    // The same refetch, run through `merge` with the app saying which bag is which.
    const incoming: Bag[] = [{ tags: ["a", "x"] }, { tags: ["b"] }];
    app.instance.bags = merge(app.instance.bags, incoming, (b) => (b as Bag).tags[0]);
    await app.settle();

    const after = [...app.container.querySelectorAll("li")];
    expect(after.map((li) => li.textContent)).toEqual(["a,x", "b"]);
    // Both rows are the nodes they were — the changed one included.
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
  });

  test("a frozen row keeps its component across a refetch", async () => {
    // `Object.freeze` leaves nothing to write identity onto, so a refetch of
    // frozen rows rebuilt every one of them. Told which row is which, `merge`
    // hands back the SAME frozen object for a row that did not change, and for
    // one that did it carries the identity onto the replacement.
    class App extends Component {
      @state items: readonly Row[] = [
        Object.freeze({ id: 1, title: "a", done: false }),
        Object.freeze({ id: 2, title: "b", done: false }),
      ];
      render() {
        return (
          <div>
            <ul>
              {list(this.items, (item) => (
                <RowView item={item} />
              ))}
            </ul>
          </div>
        );
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();
    mounts = 0;
    const before = [...app.container.querySelectorAll("li")];

    const incoming = [
      Object.freeze({ id: 1, title: "A!", done: false }),
      Object.freeze({ id: 2, title: "b", done: false }),
    ];
    app.instance.items = merge(app.instance.items, incoming, (r) => (r as Row).id);
    await app.settle();

    const after = [...app.container.querySelectorAll("li")];
    expect(after.map((li) => li.textContent)).toEqual(["A!", "b"]);
    // The unchanged row is untouched; the changed one is updated, not rebuilt.
    expect(after[1]).toBe(before[1]);
    expect(mounts).toBe(0);
  });
});
