import { describe, expect, test } from "vitest";
import { getDOM } from "../test/setup";
import { mounted, state } from "../base/decorators";
import { Component } from "../base/Component";
import { list } from "../base/list";

const microtask = () => Promise.resolve();

/**
 * A component's node COUNT changes while its siblings move.
 *
 * This is the shape the host element made impossible. A host was always exactly one node, always in
 * the document, so "where do this component's nodes go" had an answer that could not go stale. A
 * `ComponentRegion` may own two nodes, then one, then none — and a region that owns NOTHING has no
 * node of its own to read a neighbour from.
 *
 * The engine answers from the record instead: `anchorAfterRegion` searches the parent's entries for
 * the first node after this region, and `nextNodeAfter` tells three answers apart — a node, "it is
 * there with nothing after it", and "it is not in this record at all". Collapsing the last two into
 * `null` means "the end of the parent", which is an append past every later sibling.
 *
 * Everything here was probed before it was asserted, and none of it surprised: the count was driven
 * from the parent and from the component's own state, in both tick orders, with an empty region in
 * front of a full one and with an empty region last. **No fault was found — this file exists to keep
 * it that way**, because the reasoning above is the kind that stays true only while something checks.
 */
describe("a count that changes while the siblings move", () => {
  /** Rendered as one string, so a wrong POSITION fails and not only wrong contents. */
  const cellsOf = (container: HTMLElement) => container.querySelector("#row")!.innerHTML;

  test("driven from the parent: none, two, one, none, two — rotating every time", async () => {
    class Cells extends Component<{ count: number }> {
      render() {
        if (this.props.count === 0) return null;
        if (this.props.count === 2) return [<td className="own">x1</td>, <td className="own">x2</td>];
        return <td className="own">only</td>;
      }
    }

    class Row extends Component {
      @state count = 0;
      @state cols = [{ id: "a" }, { id: "b" }, { id: "c" }];

      render() {
        return (
          <table>
            <tbody>
              <tr id="row">
                <Cells count={this.count} />
                {list(this.cols, (col) => (
                  <td key={col.id} className="col">
                    {col.id}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        );
      }
    }

    const { container, instance } = await getDOM<Row>(<Row />);
    expect(cellsOf(container)).toBe('<td class="col">a</td><td class="col">b</td><td class="col">c</td>');

    // Nothing to two, and the siblings rotate in the same pass. The component owned no node a moment
    // ago, so its position comes from the record and not from a neighbour it can see.
    instance.count = 2;
    instance.cols = [{ id: "c" }, { id: "a" }, { id: "b" }];
    await microtask();
    expect(cellsOf(container)).toBe(
      '<td class="own">x1</td><td class="own">x2</td><td class="col">c</td><td class="col">a</td><td class="col">b</td>',
    );

    // Two down to one: the region shrinks while the list moves.
    instance.count = 1;
    instance.cols = [{ id: "b" }, { id: "c" }, { id: "a" }];
    await microtask();
    expect(cellsOf(container)).toBe(
      '<td class="own">only</td><td class="col">b</td><td class="col">c</td><td class="col">a</td>',
    );

    // And down to nothing, which leaves a mounted component with no nodes at all.
    instance.count = 0;
    instance.cols = [{ id: "a" }, { id: "b" }, { id: "c" }];
    await microtask();
    expect(cellsOf(container)).toBe('<td class="col">a</td><td class="col">b</td><td class="col">c</td>');

    // Back up from nothing, which is the case a host never had to answer.
    instance.count = 2;
    instance.cols = [{ id: "c" }, { id: "b" }, { id: "a" }];
    await microtask();
    expect(cellsOf(container)).toBe(
      '<td class="own">x1</td><td class="own">x2</td><td class="col">c</td><td class="col">b</td><td class="col">a</td>',
    );
  });

  /**
   * The same counts, driven by the component's OWN state — which is a different path through the
   * engine.
   *
   * A parent render rebuilds the whole row and reorders it in one pass. A self-render touches only
   * this region, so it has to place its own markup among siblings it did not build, and it reads its
   * anchor before its old nodes are unmounted. Asserted in both tick orders because "the parent
   * first" and "the child first" are two different interleavings of the same tick.
   */
  test("driven by its own state, with the parent reordering in the same tick", async () => {
    let cells: Cells | undefined;

    class Cells extends Component {
      @state count = 0;

      @mounted()
      keep() {
        cells = this;
      }

      render() {
        if (this.count === 0) return null;
        if (this.count === 2) return [<td className="own">x1</td>, <td className="own">x2</td>];
        return <td className="own">only</td>;
      }
    }

    class Row extends Component {
      @state cols = [{ id: "a" }, { id: "b" }, { id: "c" }];

      render() {
        return (
          <table>
            <tbody>
              <tr id="row">
                <Cells />
                {list(this.cols, (col) => (
                  <td key={col.id} className="col">
                    {col.id}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        );
      }
    }

    const { container, instance } = await getDOM<Row>(<Row />);

    // The child moves first in the tick, from owning nothing.
    cells!.count = 2;
    instance.cols = [{ id: "c" }, { id: "a" }, { id: "b" }];
    await microtask();
    expect(cellsOf(container)).toBe(
      '<td class="own">x1</td><td class="own">x2</td><td class="col">c</td><td class="col">a</td><td class="col">b</td>',
    );

    // And the parent first, which is the other interleaving.
    instance.cols = [{ id: "b" }, { id: "c" }, { id: "a" }];
    cells!.count = 1;
    await microtask();
    expect(cellsOf(container)).toBe(
      '<td class="own">only</td><td class="col">b</td><td class="col">c</td><td class="col">a</td>',
    );

    // A self-render alone, after the parent has settled: back to nothing, then back to two.
    cells!.count = 0;
    await microtask();
    expect(cellsOf(container)).toBe('<td class="col">b</td><td class="col">c</td><td class="col">a</td>');

    cells!.count = 2;
    await microtask();
    expect(cellsOf(container)).toBe(
      '<td class="own">x1</td><td class="own">x2</td><td class="col">b</td><td class="col">c</td><td class="col">a</td>',
    );
  });

  /**
   * Two components that own nothing, side by side, between two lists.
   *
   * The hard one. When `B` gains its first node, the search for what follows it has to walk PAST an
   * `A` that is present in the record and owns no node, and land on the tail list's first cell. An
   * empty region read as "nothing follows" would put `B`'s cells at the end of the row, after the
   * tail — and `A`'s later arrival has to land in front of a `B` that is no longer empty.
   */
  test("an empty region in front of one that gains nodes", async () => {
    const held = new Map<string, Cells>();

    class Cells extends Component<{ mark: string }> {
      @state count = 0;

      @mounted()
      keep() {
        held.set(this.props.mark, this);
      }

      render() {
        if (this.count === 0) return null;
        if (this.count === 2)
          return [
            <td className={this.props.mark}>{`${this.props.mark}1`}</td>,
            <td className={this.props.mark}>{`${this.props.mark}2`}</td>,
          ];
        return <td className={this.props.mark}>{this.props.mark}</td>;
      }
    }

    class Row extends Component {
      @state cols = [{ id: "a" }, { id: "b" }];

      render() {
        return (
          <table>
            <tbody>
              <tr id="row">
                {list(this.cols, (col) => (
                  <td key={col.id} className="head">
                    {col.id}
                  </td>
                ))}
                <Cells mark="A" />
                <Cells mark="B" />
                {list(this.cols, (col) => (
                  <td key={col.id} className="tail">
                    {col.id}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        );
      }
    }

    const { container, instance } = await getDOM<Row>(<Row />);
    const head = '<td class="head">a</td><td class="head">b</td>';
    const tail = '<td class="tail">a</td><td class="tail">b</td>';
    expect(cellsOf(container)).toBe(head + tail);

    // B first, with A still empty in front of it.
    held.get("B")!.count = 2;
    await microtask();
    expect(cellsOf(container)).toBe(`${head}<td class="B">B1</td><td class="B">B2</td>${tail}`);

    // A arrives, and must land in front of a B that is no longer empty.
    held.get("A")!.count = 2;
    await microtask();
    expect(cellsOf(container)).toBe(
      `${head}<td class="A">A1</td><td class="A">A2</td><td class="B">B1</td><td class="B">B2</td>${tail}`,
    );

    // A shrinks, B empties, and both lists rotate — all in one tick.
    held.get("A")!.count = 1;
    held.get("B")!.count = 0;
    instance.cols = [{ id: "b" }, { id: "a" }];
    await microtask();
    const rotatedHead = '<td class="head">b</td><td class="head">a</td>';
    const rotatedTail = '<td class="tail">b</td><td class="tail">a</td>';
    expect(cellsOf(container)).toBe(`${rotatedHead}<td class="A">A</td>${rotatedTail}`);

    // And B returns from nothing, behind an A that has one node.
    held.get("B")!.count = 2;
    await microtask();
    expect(cellsOf(container)).toBe(
      `${rotatedHead}<td class="A">A</td><td class="B">B1</td><td class="B">B2</td>${rotatedTail}`,
    );
  });

  /**
   * And the region that is LAST, where "nothing follows it" is the true answer.
   *
   * The three answers `nextNodeAfter` tells apart matter most here: this region really does have
   * nothing after it, and `null` is correct. The test is that the OTHER two answers have not been
   * folded into this one — the cells land at the end of the row because they belong there, not
   * because the search gave up.
   */
  test("the region that owns nothing is last in the row", async () => {
    let cells: Cells | undefined;

    class Cells extends Component {
      @state count = 0;

      @mounted()
      keep() {
        cells = this;
      }

      render() {
        if (this.count === 0) return null;
        if (this.count === 2) return [<td className="own">Z1</td>, <td className="own">Z2</td>];
        return <td className="own">Z</td>;
      }
    }

    class Row extends Component {
      @state cols = [{ id: "a" }, { id: "b" }];

      render() {
        return (
          <table>
            <tbody>
              <tr id="row">
                {list(this.cols, (col) => (
                  <td key={col.id} className="col">
                    {col.id}
                  </td>
                ))}
                <Cells />
              </tr>
            </tbody>
          </table>
        );
      }
    }

    const { container, instance } = await getDOM<Row>(<Row />);
    expect(cellsOf(container)).toBe('<td class="col">a</td><td class="col">b</td>');

    cells!.count = 2;
    await microtask();
    expect(cellsOf(container)).toBe(
      '<td class="col">a</td><td class="col">b</td><td class="own">Z1</td><td class="own">Z2</td>',
    );

    cells!.count = 0;
    instance.cols = [{ id: "b" }, { id: "a" }];
    await microtask();
    expect(cellsOf(container)).toBe('<td class="col">b</td><td class="col">a</td>');

    cells!.count = 1;
    await microtask();
    expect(cellsOf(container)).toBe('<td class="col">b</td><td class="col">a</td><td class="own">Z</td>');
  });
});
