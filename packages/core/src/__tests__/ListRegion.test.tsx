import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Host, list, state } from "../index";
import type { RamondaNode } from "../index";

/**
 * A list is ONE entry in its parent's child record, so its keys are only
 * reachable from inside it. These are the guarantees that follow from that.
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

const dump = (c: Element) =>
  Array.from(c.querySelectorAll("li"))
    .map((li) => li.textContent)
    .join(" | ");

const mark = (c: Element, index: number, value: number) => {
  const li = c.querySelectorAll("li")[index] as Element & {
    _componentInstance?: Item;
  };
  li._componentInstance!.hits = value;
};

describe("list regions", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  test("a caller's list cannot reach the component's own list", async () => {
    // The slot case: two lists that never met at authoring time still land as
    // siblings in the same <ul>, and both mint f0/f1. Only the region scoping
    // keeps them apart — nothing here has a hand-written key to get right.
    const own = [{ label: "own1" }, { label: "own2" }];
    const sent = [{ label: "sent1" }, { label: "sent2" }];

    @Host("div")
    class Panel extends Component<{ children?: RamondaNode }> {
      render() {
        return (
          <ul>
            {list({ each: own, render: (row: Row) => <Item row={row} /> })}
            {this.props.children}
          </ul>
        );
      }
    }

    @Host("div")
    class App extends Component {
      @state passed: Row[] = sent;
      render() {
        return <Panel>{list({ each: this.passed, render: (row: Row) => <Item row={row} /> })}</Panel>;
      }
    }

    const app = await getDOM<App>(<App />);
    await app.settle();
    expect(dump(app.container)).toBe("own1#0 | own2#0 | sent1#0 | sent2#0");

    mark(app.container, 2, 7);
    mark(app.container, 3, 8);
    await app.settle();

    // Drop one item from the CALLER's list. The panel's own list is untouched.
    app.instance.passed = [sent[1]];
    await app.settle();

    expect(dump(app.container)).toBe("own1#0 | own2#0 | sent2#8");
  });

  test("a bare list returned from render() lands in the host", async () => {
    // @Host provides the element, so returning the list itself is legal —
    // this is how a <tr> emits N <td> without a wrapper around them.
    const cells = [{ label: "c1" }, { label: "c2" }, { label: "c3" }];

    @Host("ul")
    class Bare extends Component {
      render() {
        return list({ each: cells, render: (row: Row) => <Item row={row} /> });
      }
    }

    const app = await getDOM<Bare>(<Bare />);
    await app.settle();

    expect(dump(app.container)).toBe("c1#0 | c2#0 | c3#0");
    expect(app.container.querySelector("ul")!.children.length).toBe(3);
  });

  test("a list that stops being rendered unmounts and leaves no stale record", async () => {
    const rows = [{ label: "x" }, { label: "y" }];

    @Host("div")
    class Toggling extends Component {
      @state show = true;
      render() {
        return (
          <ul>
            <li id="keep">keep</li>
            {this.show ? list({ each: rows, render: (row: Row) => <Item row={row} /> }) : null}
          </ul>
        );
      }
    }

    const app = await getDOM<Toggling>(<Toggling />);
    await app.settle();
    expect(app.container.querySelectorAll("li").length).toBe(3);

    app.instance.show = false;
    await app.settle();
    expect(app.container.querySelectorAll("li").length).toBe(1);
    expect(app.container.querySelector("#keep")).toBeTruthy();

    // Back again: the record was cleared, so this rebuilds rather than
    // reordering against nodes that no longer exist.
    app.instance.show = true;
    await app.settle();
    expect(dump(app.container)).toBe("keep | x#0 | y#0");
  });
});
