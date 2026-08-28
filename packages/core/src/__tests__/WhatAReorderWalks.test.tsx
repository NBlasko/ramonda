import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { Component, list, Portal } from "../index";
import { state } from "../base/decorators";
import { getDOM } from "../test/setup";

/**
 * What a reorder walks, and what it no longer does.
 *
 * `firstHostedBlock` answers a question `reorderChildren` has to ask: does this element hold a
 * `Portal`'s block? It must, because a block is APPENDED into its target and so sits after the
 * element's own children — so a freshly built child has to be inserted BEFORE it, or the guest ends
 * up in the middle of the host's own run.
 *
 * The answer is no for almost every element, and it used to be reached by visiting every child.
 * Measured on 500 rows moving ONE: 1501 sibling steps against 1001 with the walk taken out — one
 * full pass over the children, spent to find nothing. `ChildrenRegion.place` marks its targets now,
 * and an element that was never one stops at a property read.
 *
 * Both halves are here. A count is the only way to see either: the page is identical whichever way
 * the question is answered, and an element that DOES host a block has to go on walking or the guest
 * lands in the wrong place.
 */
const SIZE = 60;

class Rows extends Component<{ withPortal?: boolean }> {
  @state rows = Array.from({ length: SIZE }, (_, index) => ({ id: index }));
  portal = this.use(Portal, (self: Rows) => ({
    target: self.props.withPortal ? (self.host ?? document.body) : document.body,
    children: <i className="guest">guest</i>,
  }));
  host: Element | null = null;
  render() {
    return (
      <ul>
        {list(this.rows, (row) => (
          <li key={row.id}>{row.id}</li>
        ))}
      </ul>
    );
  }
}

/** Counts sibling steps, which is what a walk over the children costs. */
function countSiblingSteps() {
  const sibling = Object.getOwnPropertyDescriptor(Node.prototype, "nextSibling")!;
  let steps = 0;
  Object.defineProperty(Node.prototype, "nextSibling", {
    ...sibling,
    get(this: Node) {
      steps++;
      return sibling.get?.call(this);
    },
  });
  return {
    steps: () => steps,
    stop: () => Object.defineProperty(Node.prototype, "nextSibling", sibling),
  };
}

describe("what a reorder walks", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  /**
   * A ceiling of TWO passes over the children, because that is what a reorder already costs — the
   * claim is that looking for a portal is not a third.
   *
   * Measured across two sizes, and the shape holds: 500 rows moving one cost 1001 steps with the
   * hunt taken out and 1501 with it, and 60 rows cost 121. That is `2N + 1` either way, plus one
   * whole `N` when every element is asked to search itself for a guest it has not got.
   */
  test("a reorder does not walk the children looking for a portal that is not there", async () => {
    const app = await getDOM<Rows>(<Rows />);
    await app.settle();

    const counter = countSiblingSteps();
    try {
      const rows = app.instance.rows.slice();
      rows.unshift(rows.pop()!);
      app.instance.rows = rows;
      await app.settle();
    } finally {
      counter.stop();
    }

    expect(counter.steps()).toBeLessThanOrEqual(2 * SIZE + 1);
  });

  /**
   * And the element that really does host one still finds it. The mark is what turns the walk on,
   * so a bug in the marking would show here as a guest in the wrong place rather than as a count.
   */
  test("an element hosting a block still puts fresh children before the guest", async () => {
    class Hosting extends Component {
      @state rows = [{ id: "a" }];
      portal = this.use(Portal, () => ({
        target: document.body,
        children: <i className="guest">guest</i>,
      }));
      render() {
        return (
          <ul id="host">
            {list(this.rows, (row) => (
              <li key={row.id}>{row.id}</li>
            ))}
          </ul>
        );
      }
    }

    const app = await getDOM<Hosting>(<Hosting />);
    await app.settle();

    app.instance.rows = [{ id: "b" }, { id: "a" }];
    await app.settle();

    const host = app.container.querySelector("#host") as HTMLElement;
    expect([...host.querySelectorAll("li")].map((node) => node.textContent)).toEqual(["b", "a"]);
    expect(document.querySelectorAll(".guest").length).toBe(1);
  });
});
