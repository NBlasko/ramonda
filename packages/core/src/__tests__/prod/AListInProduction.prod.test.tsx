import { describe, expect, test } from "vitest";
import { getDOM, instanceOf } from "../../test/setup";
import { Component } from "../../base/Component";
import { state } from "../../base/decorators";
import { list } from "../../base/list";

/**
 * `list()` in a production build, which nothing had ever called.
 *
 * The union of both coverage runs said so plainly: `base/list.ts`'s only branch is
 * `if (__DEV__) guardAgainstArrayUse(descriptor)`, and its false side was unhit — 501 calls in the
 * development run, **zero** in the production one. So the framework's primitive for rows had no
 * production coverage at all, and the two builds are not the same object: in development the
 * descriptor carries five extra properties whose only job is to explain a mistake, and in a shipped
 * build it carries none of them.
 *
 * Reading found no way for that to matter — nothing in the framework asks a child for its `length`
 * or whether it is iterable, so the guard's `length` getter and `Symbol.iterator` are invisible to
 * it. This is the measurement that says so rather than the argument.
 *
 * Everything below came back identical to the development behaviour, so nothing here is a fix. The
 * strongest one is the REFETCH: every row object is replaced and the order changes, and each row
 * still keeps its own `@state` and its own DOM node with no `key` written anywhere. The plain
 * reverse is weaker than it looks and says so where it stands.
 *
 * Run it the way `test:prod` does — `NODE_ENV=production` is what makes `__DEV__` false. Without it
 * this file measures the development build while reading as a production one.
 */
describe("a list in a production build", () => {
  type Row = { id: number; label: string };

  class RowView extends Component<{ row: Row }> {
    @state typed = "";
    render() {
      return <li>{`${this.props.row.label}|${this.typed}`}</li>;
    }
  }

  class App extends Component {
    @state rows: Row[] = [
      { id: 1, label: "a" },
      { id: 2, label: "b" },
      { id: 3, label: "c" },
    ];
    render() {
      return <ul>{list(this.rows, (row) => (<RowView row={row} />) as never)}</ul>;
    }
  }

  test("rows render, reorder, grow, shrink and empty — and a row keeps its own state and node", async () => {
    // The guard on the instrument: without this the whole file could be measuring the dev build.
    expect(__DEV__).toBe(false);

    const app = await getDOM<App>(<App />);
    const rows = () => Array.from(app.container.querySelectorAll("li"));
    expect(app.container.textContent).toBe("a|b|c|");
    expect(rows()).toHaveLength(3);

    // State on the MIDDLE row, so identity has something to carry that the markup cannot fake.
    const middle = rows()[1]!;
    instanceOf<RowView>(middle).typed = "X";
    await app.settle();
    expect(app.container.textContent).toBe("a|b|Xc|");

    // Reversed with no `key` anywhere. These are the SAME row objects, so this much is reference
    // matching — the test below is the one that reaches the identity machinery.
    app.instance.rows = [...app.instance.rows].reverse();
    await app.settle();
    expect(app.container.textContent).toBe("c|b|Xa|");
    expect(rows()[1]).toBe(middle);

    app.instance.rows = [{ id: 0, label: "z" }, ...app.instance.rows];
    await app.settle();
    expect(app.container.textContent).toBe("z|c|b|Xa|");
    expect(rows()).toHaveLength(4);

    // The row carrying state goes, and the ones around it are undisturbed.
    app.instance.rows = app.instance.rows.filter((row) => row.id !== 2);
    await app.settle();
    expect(app.container.textContent).toBe("z|c|a|");
    expect(rows()).toHaveLength(3);

    app.instance.rows = [];
    await app.settle();
    expect(app.container.textContent).toBe("");
    expect(rows()).toHaveLength(0);

    // And back from empty, which is the case an anchor-based region has to get right.
    app.instance.rows = [{ id: 9, label: "n" }];
    await app.settle();
    expect(app.container.textContent).toBe("n|");
    expect(rows()).toHaveLength(1);

    app.unmount();
  });

  /**
   * The harder promise, and the one the first test does NOT reach.
   *
   * Reversing the array above keeps the same row OBJECTS, so the diff can match them by reference
   * and every identity mechanism can be broken without that test noticing — planted three ways:
   * `identityOf` answering nothing, `stampIdentity` writing nothing, `carryIdentity` not carrying.
   * All three left it green, which is what sent me to write this one.
   *
   * A refetch is the real case: every object is NEW, the data is the same, and the order changed.
   * Reference matching has nothing to work with, so what carries a row's `@state` across it is the
   * identity `list()` infers from a distinguishing field — with no `key` written anywhere.
   */
  test("a refetch that replaces every row object still carries each row's state", async () => {
    expect(__DEV__).toBe(false);

    const app = await getDOM<App>(<App />);
    const rows = () => Array.from(app.container.querySelectorAll("li"));

    instanceOf<RowView>(rows()[1]!).typed = "X";
    await app.settle();
    expect(app.container.textContent).toBe("a|b|Xc|");
    const middle = rows()[1]!;

    // A fresh array of fresh objects, same ids, reversed — what a refetch hands you.
    app.instance.rows = app.instance.rows.map((row) => ({ ...row })).reverse();
    await app.settle();

    expect(app.container.textContent).toBe("c|b|Xa|");
    expect(rows()[1]).toBe(middle);

    app.unmount();
  });

  /**
   * The descriptor itself, which is the branch this file exists for.
   *
   * In development `guardAgainstArrayUse` defines five properties on it — `length`, `map`,
   * `forEach`, `filter` and `Symbol.iterator` — so that `list(…).map(…)` explains itself instead of
   * failing as "not a function". A shipped build pays for none of them, and this is what says so.
   */
  test("the descriptor carries none of the development guard", () => {
    const descriptor = list([1], () => null as never) as unknown as object;

    expect(Object.getOwnPropertyNames(descriptor)).toEqual(["owner", "each", "builder"]);
    expect(Symbol.iterator in descriptor).toBe(false);
    expect((descriptor as { length?: unknown }).length).toBeUndefined();
    // The brand is not part of the guard: it is how the diff recognises a list at all.
    expect(Object.getOwnPropertySymbols(descriptor).map(String)).toEqual(["Symbol(isList)"]);
  });
});
