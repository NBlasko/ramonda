import { describe, test, expect } from "vitest";
import { getDOM, instanceOf } from "../test/setup";
import { state } from "../base/decorators";
import { Component } from "../base/Component";

/**
 * Keyed reconciliation must do BOTH jobs: preserve instances across a reorder
 * (no remount) AND put the DOM in the requested order.
 */
describe("keyed reconciliation: DOM order", () => {
  const text = (el: Element) => Array.from(el.querySelectorAll("li")).map((li) => li.textContent);

  test("reorders keyed elements to match the new order", async () => {
    class List extends Component {
      @state items = ["A", "B", "C"];
      render() {
        return (
          <ul>
            {this.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        );
      }
    }

    const app = await getDOM<List>(<List />);
    expect(text(app.container)).toEqual(["A", "B", "C"]);

    app.instance.items = ["C", "A", "B"];
    await app.settle();

    expect(text(app.container)).toEqual(["C", "A", "B"]);
  });

  test("a reorder moves the SAME nodes (no remount)", async () => {
    class List extends Component {
      @state items = ["A", "B", "C"];
      render() {
        return (
          <ul>
            {this.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        );
      }
    }

    const app = await getDOM<List>(<List />);
    const before = Array.from(app.container.querySelectorAll("li"));

    app.instance.items = ["C", "B", "A"];
    await app.settle();

    const after = Array.from(app.container.querySelectorAll("li"));
    // Same three node objects, reversed — proof the nodes moved, not rebuilt.
    expect(after).toEqual([before[2], before[1], before[0]]);
  });

  test("keeps component state across a reorder", async () => {
    class Row extends Component<{ label: string }> {
      @state touched = "";
      render() {
        return (
          <li>
            <span>{this.props.label}</span>
          </li>
        );
      }
    }
    class List extends Component {
      @state items = ["A", "B", "C"];
      render() {
        return (
          <ul>
            {this.items.map((item) => (
              <Row key={item} label={item} />
            ))}
          </ul>
        );
      }
    }

    const app = await getDOM<List>(<List />);
    const rows = Array.from(app.container.querySelectorAll("li"));
    // Mark the middle row's instance so we can find it again after the move.
    instanceOf<any>(rows[1]).touched = "marked";
    await app.settle();

    app.instance.items = ["B", "C", "A"];
    await app.settle();

    const moved = Array.from(app.container.querySelectorAll("li"));
    expect(moved.map((r) => r.textContent)).toEqual(["B", "C", "A"]);
    // "B" is now first and still carries its state → instance survived the move.
    expect(instanceOf<any>(moved[0]).touched).toBe("marked");
  });

  test("handles insert, remove and move in one update", async () => {
    class List extends Component {
      @state items = ["A", "B", "C", "D"];
      render() {
        return (
          <ul>
            {this.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        );
      }
    }

    const app = await getDOM<List>(<List />);

    // Drop B, move D to the front, add E at the end.
    app.instance.items = ["D", "A", "C", "E"];
    await app.settle();

    expect(text(app.container)).toEqual(["D", "A", "C", "E"]);
  });

  test("inserts a new node in the middle, not where it was appended", async () => {
    class List extends Component {
      @state items = ["A", "B"];
      render() {
        return (
          <ul>
            {this.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        );
      }
    }

    const app = await getDOM<List>(<List />);

    // C is mounted by appending it to the end — the reorder pass has to pull it
    // back into the middle, which it can only do if it knows the node.
    app.instance.items = ["A", "C", "B"];
    await app.settle();

    expect(text(app.container)).toEqual(["A", "C", "B"]);
  });

  test("swaps in a new component when a key keeps but the type changes", async () => {
    class Alpha extends Component {
      render() {
        return (
          <li>
            <span>alpha</span>
          </li>
        );
      }
    }
    class Beta extends Component {
      render() {
        return (
          <li>
            <span>beta</span>
          </li>
        );
      }
    }
    class List extends Component {
      @state useAlpha = true;
      render() {
        return (
          <ul>
            {this.useAlpha ? <Alpha key="x" /> : <Beta key="x" />}
            <li>tail</li>
          </ul>
        );
      }
    }

    const app = await getDOM<List>(<List />);
    expect(text(app.container)).toEqual(["alpha", "tail"]);

    app.instance.useAlpha = false;
    await app.settle();

    // The old node must be gone, not orphaned alongside the new one.
    expect(text(app.container)).toEqual(["beta", "tail"]);
  });
});
