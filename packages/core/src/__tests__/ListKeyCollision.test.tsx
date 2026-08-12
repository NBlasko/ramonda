import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, list, state } from "../index";

/**
 * Two lists rendered into the SAME parent element.
 *
 * `minted` is a per-list counter, so both mint `f0`, `f1`, `f2`.
 * `flattenMixedArray` used to splice both arrays into the parent's children, and
 * the diff built ONE key→index map for all of them — so the second list's keys
 * overwrote the first's, and the two lists claimed each other's DOM nodes.
 *
 * The damage is invisible on screen: every node ends up with the right TEXT,
 * because whatever node gets claimed is then updated to the correct content.
 * What moves is the components' internal state. Hence `#hits` rather than
 * labels — a text-only assertion passes while the bug is fully present.
 *
 * The fault it stands for: "two `For` instances in one parent mint the same ids". The
 * mechanism is unchanged now that lists come from `list()` rather than a hook,
 * because the ids are minted per list either way.
 */

interface Row {
  label: string;
}

@Host("li")
class Item extends Component<{ row: Row }> {
  @state hits = 0;
  render() {
    return (
      <span>
        {this.props.row.label}#{this.hits}
      </span>
    );
  }
}

const a1: Row = { label: "a1" };
const a2: Row = { label: "a2" };
const a3: Row = { label: "a3" };
const b1: Row = { label: "b1" };
const b2: Row = { label: "b2" };
const b3: Row = { label: "b3" };

@Host("div")
class TwoLists extends Component {
  @state listA: Row[] = [a1, a2, a3];
  @state listB: Row[] = [b1, b2, b3];

  render() {
    return (
      <ul>
        {list(this.listA, (row: Row) => <Item row={row} />)}
        {list(this.listB, (row: Row) => <Item row={row} />)}
      </ul>
    );
  }
}

const dump = (c: Element) =>
  Array.from(c.querySelectorAll("li"))
    .map((li) => li.textContent)
    .join(" | ");

describe("two lists in one parent", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  test("state stays in its own list when the other list changes", async () => {
    const app = await getDOM<TwoLists>(<TwoLists />);
    await app.settle();

    const lis = app.container.querySelectorAll("li");

    // Mark every item of list B. List A is left at #0 throughout.
    Array.from(lis)
      .slice(3)
      .forEach((li, i) => {
        (li as Element & { _componentInstance?: Item })._componentInstance!.hits = (i + 1) * 10;
      });
    await app.settle();
    expect(dump(app.container)).toBe("a1#0 | a2#0 | a3#0 | b1#10 | b2#20 | b3#30");

    // Remove the middle item of list A. List B is not touched at all.
    app.instance.listA = [a1, a3];
    await app.settle();

    // Before the child record this produced
    // "a1#10 | a3#30 | b1#0 | b2#20 | b3#0" — B's state jumped onto A.
    expect(dump(app.container)).toBe("a1#0 | a3#0 | b1#10 | b2#20 | b3#30");
  });
});
