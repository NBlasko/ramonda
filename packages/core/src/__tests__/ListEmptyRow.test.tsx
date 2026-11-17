import { describe, test, expect, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component, state, list } from "../index";
import { State } from "../reactivity/State";
import { attach, detach } from "../helpers/constants";

/**
 * A row whose callback produced nothing (`null`, which the types refuse and RMD013 reports) — it keeps one
 * scope, used again pass after pass.
 *
 * Made afresh on every pass instead, the last pass's scope was in neither the old map nor the new one and was
 * never let go: a signal the row read gathered one more subscription per pass, and each of them rebuilt the
 * list when it changed.
 */

/** A signal whose subscriptions are counted: attached less detached. */
function counted<T>(value: T): { signal: State<T>; live: () => number } {
  const signal = new State(value);
  let live = 0;
  const on = signal[attach].bind(signal);
  const off = signal[detach].bind(signal);
  (signal as unknown as Record<symbol, unknown>)[attach] = (listener: unknown) => {
    live++;
    return on(listener as never);
  };
  (signal as unknown as Record<symbol, unknown>)[detach] = (id: unknown) => {
    live--;
    return off(id as never);
  };
  return { signal, live: () => live };
}

describe("a list row whose callback produced nothing", () => {
  test("keeps one subscription, pass after pass, whether the list is handed a new array or re-runs the row", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const hidden = counted(false);
    class Rows extends Component {
      @state items = [1, 2, 3];
      render() {
        return (
          <ul>
            {list(this.items, ((n: number) => {
              void hidden.signal.get();
              return n === 2 ? null : <li>{n}</li>;
            }) as never)}
          </ul>
        );
      }
    }
    const app = await getDOM<Rows>(<Rows />);
    await app.settle();
    const seen = [hidden.live()];
    for (let pass = 0; pass < 3; pass++) {
      app.instance.items = [...app.instance.items];
      await app.settle();
      seen.push(hidden.live());
    }
    hidden.signal.set(true);
    await app.settle();
    seen.push(hidden.live());
    vi.restoreAllMocks();
    expect(seen).toEqual([3, 3, 3, 3, 3]);
  });

  test("comes back when what it read changes", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const shown = new State(false);
    class Rows extends Component {
      @state items = [1, 2, 3];
      render() {
        // `null` is what the types refuse and what this is about: the row a callback produced nothing for.
        return <ul>{list(this.items, ((n: number) => (n === 2 && !shown.get() ? null : <li>{n}</li>)) as never)}</ul>;
      }
    }
    const app = await getDOM<Rows>(<Rows />);
    await app.settle();
    const before = app.container.querySelectorAll("li").length;
    shown.set(true);
    await app.settle();
    const after = Array.from(app.container.querySelectorAll("li"), (li) => li.textContent);
    vi.restoreAllMocks();
    expect({ before, after }).toEqual({ before: 2, after: ["1", "2", "3"] });
  });

  test("lets its subscription go when its item leaves the list", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const hidden = counted(false);
    class Rows extends Component {
      @state items = [1, 2, 3];
      render() {
        return (
          <ul>
            {list(this.items, ((n: number) => {
              void hidden.signal.get();
              return n === 2 ? null : <li>{n}</li>;
            }) as never)}
          </ul>
        );
      }
    }
    const app = await getDOM<Rows>(<Rows />);
    await app.settle();
    app.instance.items = [1, 3];
    await app.settle();
    const live = hidden.live();
    vi.restoreAllMocks();
    expect(live).toBe(2);
  });

  test("is not asked again while nothing it read has moved", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    let asked = 0;
    class Rows extends Component {
      @state items = [1, 2, 3];
      row(n: number) {
        if (n !== 2) return <li>{n}</li>;
        asked++;
        return null;
      }
      render() {
        return <ul>{list(this.items, this.row as never)}</ul>;
      }
    }
    const app = await getDOM<Rows>(<Rows />);
    await app.settle();
    for (let pass = 0; pass < 3; pass++) {
      app.instance.items = [...app.instance.items];
      await app.settle();
    }
    vi.restoreAllMocks();
    expect(asked).toBe(1);
  });

  test("leaves the list taking its rows by position when it is handed the same array again", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    class Rows extends Component {
      @state items = [1, 2, 3];
      @state picked = 0;
      row(n: number) {
        return n === 2 ? null : <li className={this.picked === n ? "on" : ""}>{n}</li>;
      }
      render() {
        return <ul>{list(this.items, this.row as never)}</ul>;
      }
    }
    const app = await getDOM<Rows>(<Rows />);
    await app.settle();
    const Original = globalThis.Map;
    let made = 0;
    globalThis.Map = class extends Original<unknown, unknown> {
      constructor(entries?: Iterable<readonly [unknown, unknown]> | null) {
        super(entries);
        // Only the list engine's: the frame that called `new Map`, under the constructor's own.
        if (new Error().stack?.split("\n")[2]?.includes("listEngine")) made++;
      }
    } as MapConstructor;
    try {
      app.instance.picked = 3;
      await app.settle();
    } finally {
      globalThis.Map = Original;
      vi.restoreAllMocks();
    }
    expect(made).toBe(0);
  });
});
