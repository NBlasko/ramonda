import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getDOM } from "../test/setup";
import { Component, state, list } from "../index";
import { State } from "../reactivity/State";
import { componentAt } from "../core/DiffAndMerge";

/**
 * A list handed the SAME array again while a row of it was invalidated — every row of a list reading the
 * one signal that moved, as a select does. Each id and each row's scope is then where the last pass left
 * it, so the engine takes them by position and rebuilds none of the maps that find them by item or id.
 */
interface Item {
  readonly id: number;
  readonly label: string;
}

class Picker extends Component {
  @state items: Item[] = [1, 2, 3].map((id) => ({ id, label: `item ${id}` }));
  @state picked = 0;
  @state hidden = 0;
  row(item: Item) {
    if (item.id === this.hidden) return null;
    return (
      <li key={item.id} className={this.picked === item.id ? "on" : ""}>
        {item.label}
      </li>
    );
  }
  render() {
    // `as never`: a row that renders nothing is refused by the types (RMD013) and survived at run time.
    return <ul>{list(this.items, this.row as never)}</ul>;
  }
}

describe("a list handed the same array again", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  test("builds no map of the list engine's to find its rows", async () => {
    const app = await getDOM<Picker>(<Picker />);
    await app.settle();
    const Original = globalThis.Map;
    let made = 0;
    globalThis.Map = class extends Original<unknown, unknown> {
      constructor(entries?: Iterable<readonly [unknown, unknown]> | null) {
        super(entries);
        // Only the list engine's: the diff makes maps of its own on every pass.
        // The frame that called `new Map`, under the constructor's own.
        if (new Error().stack?.split("\n")[2]?.includes("listEngine")) made++;
      }
    } as MapConstructor;
    try {
      app.instance.picked = 2;
      await app.settle();
    } finally {
      globalThis.Map = Original;
    }
    const classes = Array.from(app.container.querySelectorAll("li"), (li) => li.className);
    expect({ made, classes }).toEqual({ made: 0, classes: ["", "on", ""] });
  });

  test("a row that renders nothing goes, and is built again when it renders something", async () => {
    const app = await getDOM<Picker>(<Picker />);
    await app.settle();
    const second = app.container.querySelectorAll("li")[1];
    app.instance.hidden = 2;
    await app.settle();
    const gone = Array.from(app.container.querySelectorAll("li"), (li) => li.textContent);
    app.instance.hidden = 0;
    app.instance.picked = 2;
    await app.settle();
    const back = Array.from(app.container.querySelectorAll("li"), (li) => `${li.textContent}:${li.className}`);
    expect({ gone, back, rebuilt: app.container.querySelectorAll("li")[1] !== second }).toEqual({
      gone: ["item 1", "item 3"],
      back: ["item 1:", "item 2:on", "item 3:"],
      rebuilt: true,
    });
  });

  test("an item replaced in place is the new item's row, though nothing else in it changed", async () => {
    class Labels extends Component {
      @state items: Item[] = [1, 2, 3].map((id) => ({ id, label: `item ${id}` }));
      @state picked = 0;
      row(item: Item) {
        // Only the last row reads `picked`: the first is not invalidated by it.
        const on = item.id === 3 && this.picked === 3;
        return (
          <li key={item.id} className={on ? "on" : ""}>
            {item.label}
          </li>
        );
      }
      render() {
        return <ul>{list(this.items, this.row)}</ul>;
      }
    }
    const app = await getDOM<Labels>(<Labels />);
    await app.settle();
    // In place — reported in development (RMD005), and still rendered right.
    (app.instance.items as Item[])[0] = { id: 1, label: "renamed" };
    app.instance.picked = 3;
    await app.settle();
    const renamed = app.container.querySelector("li") as HTMLElement;
    // A copy of the array next: the renamed row is still the row it was.
    app.instance.items = [...app.instance.items];
    await app.settle();
    expect({ text: renamed.textContent, kept: app.container.querySelector("li") === renamed }).toEqual({
      text: "renamed",
      kept: true,
    });
  });

  // It keeps what it read — once — so a signal it read can bring it back; see ListEmptyRow.test.tsx.
  test("a row that renders nothing keeps what it read, once, and gathers no more", async () => {
    const shared = new State(0);
    const listeners = () => (shared as unknown as { _listeners?: Map<unknown, unknown> })._listeners?.size ?? 0;
    class Reading extends Component {
      @state items: Item[] = [1, 2, 3].map((id) => ({ id, label: `item ${id}` }));
      @state hidden = 0;
      row(item: Item) {
        shared.get();
        if (item.id === this.hidden) return null;
        return <li key={item.id}>{item.label}</li>;
      }
      render() {
        return <ul>{list(this.items, this.row as never)}</ul>;
      }
    }
    const app = await getDOM<Reading>(<Reading />);
    await app.settle();
    const before = listeners();
    app.instance.hidden = 2;
    await app.settle();
    const after = listeners();
    shared.set(1);
    await app.settle();
    expect({ before, after, again: listeners() }).toEqual({ before: 3, after: 3, again: 3 });
  });

  test("a row taken off the end in place lets go of what it read", async () => {
    const shared = new State(0);
    const listeners = () => (shared as unknown as { _listeners?: Map<unknown, unknown> })._listeners?.size ?? 0;
    class Popping extends Component {
      @state items: Item[] = [1, 2, 3].map((id) => ({ id, label: `item ${id}` }));
      @state picked = 0;
      row(item: Item) {
        shared.get();
        return (
          <li key={item.id} className={this.picked === item.id ? "on" : ""}>
            {item.label}
          </li>
        );
      }
      render() {
        return <ul>{list(this.items, this.row)}</ul>;
      }
    }
    const app = await getDOM<Popping>(<Popping />);
    await app.settle();
    // In place — reported in development (RMD005).
    (app.instance.items as Item[]).pop();
    app.instance.picked = 1;
    await app.settle();
    expect({ rows: app.container.querySelectorAll("li").length, listeners: listeners() }).toEqual({
      rows: 2,
      listeners: 2,
    });
  });

  test("a row's state goes with its item when the array is reversed in place", async () => {
    class Line extends Component<{ item: Item }> {
      @state open = false;
      render() {
        return <li className={this.open ? "open" : ""}>{this.props.item.label}</li>;
      }
    }
    class Lines extends Component {
      @state items: Item[] = [1, 2, 3].map((id) => ({ id, label: `item ${id}` }));
      @state tick = 0;
      line(item: Item) {
        // Every row reads `tick`, so the pass after the reverse rebuilds them all over the same array.
        void this.tick;
        return <Line item={item} />;
      }
      render() {
        return <ul>{list(this.items, this.line)}</ul>;
      }
    }
    const app = await getDOM<Lines>(<Lines />);
    await app.settle();
    (componentAt(app.container.querySelector("li") as Element) as Line).open = true;
    await app.settle();
    // In place — reported in development (RMD005), and still rendered right.
    (app.instance.items as Item[]).reverse();
    app.instance.tick++;
    await app.settle();
    const lis = Array.from(app.container.querySelectorAll("li"), (li) => `${li.textContent}:${li.className}`);
    expect(lis).toEqual(["item 3:", "item 2:", "item 1:open"]);
  });
});
