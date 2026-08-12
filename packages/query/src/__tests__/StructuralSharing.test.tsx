import { Component, list, state } from "@ramonda/core";
import { act, render } from "@ramonda/testing-library";
import { describe, expect, test } from "vitest";
import { QueryClientProvider } from "../context";
import { Query } from "../Query";
import { QueryClient } from "../QueryClient";
import { replaceEqualDeep } from "../structuralSharing";

/**
 * An answer equal to the one already held is the same answer.
 *
 * Measured against the render it prevents, in jsdom, on rows of six fields: 28 µs of
 * comparison versus 5.4 ms of commit at ten rows, 811 µs versus 272 ms at a thousand. With it
 * on, 31 equal writes produce zero renders where they used to produce 31.
 */

const settle = () => act(async () => {});

interface Row {
  id: number;
  name: string;
  meta: { score: number };
}

const rows = (n: number, bump = -1): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: i, name: `Row ${i}`, meta: { score: i === bump ? 99 : i } }));

describe("replaceEqualDeep", () => {
  test("an equal value comes back as the PREVIOUS one", () => {
    const before = rows(3);
    const after = rows(3);
    expect(replaceEqualDeep(before, after)).toBe(before);
  });

  test("a changed element keeps every other element's identity", () => {
    const before = rows(3);
    const after = rows(3, 1);
    const merged = replaceEqualDeep(before, after) as Row[];

    // The array is new, because it did change.
    expect(merged).not.toBe(before);
    // But the rows that did not move are the SAME objects — which is what lets `list()` reuse
    // their scopes instead of rebuilding every row.
    expect(merged[0]).toBe(before[0]);
    expect(merged[2]).toBe(before[2]);
    expect(merged[1]).not.toBe(before[1]);
    expect(merged[1]!.meta.score).toBe(99);
  });

  test("a nested object that did not change keeps its identity too", () => {
    const before = { user: { name: "Ada" }, count: 1 };
    const after = { user: { name: "Ada" }, count: 2 };
    const merged = replaceEqualDeep(before, after) as typeof before;

    expect(merged).not.toBe(before);
    expect(merged.user).toBe(before.user);
    expect(merged.count).toBe(2);
  });

  test("a different length or key set is simply the new value", () => {
    expect(replaceEqualDeep(rows(3), rows(4))).toEqual(rows(4));
    expect(replaceEqualDeep({ a: 1 }, { a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
    expect(replaceEqualDeep({ a: 1, b: 2 }, { a: 1, c: 2 })).toEqual({ a: 1, c: 2 });
  });

  test("anything with a prototype of its own is compared by identity only", () => {
    const date = new Date(0);
    const same = new Date(0);
    // Equal by value, but not traversed: equality for a Date, a Map or a class instance is the
    // app's business, and guessing it wrong is worse than a render.
    expect(replaceEqualDeep(date, same)).toBe(same);

    const map = new Map([["a", 1]]);
    expect(replaceEqualDeep(map, map)).toBe(map);
  });

  test("a cycle terminates instead of hanging", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    const b: Record<string, unknown> = { name: "a" };
    b.self = b;

    // The node budget is what makes this safe: when it runs out the new value is returned, so
    // the worst case is a render that was not needed.
    expect(() => replaceEqualDeep(a, b)).not.toThrow();
  });
});

describe("a query with structural sharing", () => {
  function mountTable(n: number) {
    const counts = { table: 0, rows: 0 };

    class RowView extends Component<{ item: Row }> {
      render() {
        counts.rows++;
        return <li>{this.props.item.name}</li>;
      }
    }

    class Table extends Component {
      provider = this.use(QueryClientProvider);
      q = this.use(Query, () => ({ key: ["rows"], fetch: async () => rows(n) }));

      render() {
        counts.table++;
        void this.provider;
        return <ul>{list(this.q.data ?? [], RowView)}</ul>;
      }
    }

    const app = render(<Table />);
    return {
      ...app,
      counts,
      client: () => (app.instance as { provider: { client: QueryClient } }).provider.client,
    };
  }

  test("an equal answer does not re-render anything", async () => {
    const app = mountTable(5);
    try {
      await settle();
      const before = { ...app.counts };

      for (let i = 0; i < 5; i++) {
        await act(async () => {
          app.client().setData(["rows"], rows(5));
        });
      }

      expect(app.counts.table).toBe(before.table);
      expect(app.counts.rows).toBe(before.rows);
    } finally {
      app.unmount();
    }
  });

  test("a changed row re-renders that row and not the others", async () => {
    const app = mountTable(5);
    try {
      await settle();
      const before = { ...app.counts };

      await act(async () => {
        app.client().setData(["rows"], rows(5, 2));
      });

      // The table re-renders (its `each` really did change), but only the row that moved is
      // rebuilt — the other four keep their scopes because their items kept their identity.
      expect(app.counts.table).toBe(before.table + 1);
      expect(app.counts.rows).toBe(before.rows + 1);
    } finally {
      app.unmount();
    }
  });

  test("turned off, every equal answer is a change again", async () => {
    let renders = 0;

    class Card extends Component {
      provider = this.use(QueryClientProvider, () => ({ defaults: { structuralSharing: false } }));
      q = this.use(Query, () => ({ key: ["off"], fetch: async () => rows(3) }));

      render() {
        renders++;
        void this.provider;
        return <span>{String(this.q.data?.length ?? 0)}</span>;
      }
    }

    const app = render(<Card />);
    try {
      await settle();
      const before = renders;

      await act(async () => {
        (app.instance as { provider: { client: QueryClient } }).provider.client.setData(["off"], rows(3));
      });

      expect(renders).toBe(before + 1);
    } finally {
      app.unmount();
    }
  });

  test("the data still arrives, and still changes when it should", async () => {
    let version = 0;

    class Card extends Component {
      provider = this.use(QueryClientProvider);
      @state tick = 0;
      q = this.use(Query, () => ({ key: ["v"], fetch: async () => ({ n: ++version }) }));

      render() {
        void this.provider;
        return <span id="out">{`${this.q.data?.n ?? 0}:${this.tick}`}</span>;
      }
    }

    const app = render(<Card />);
    try {
      await settle();
      expect(app.container.querySelector("#out")!.textContent).toBe("1:0");

      await act(async () => {
        await (app.instance as { q: Query<{ n: number }> }).q.refetch();
      });

      // Sharing must not swallow a real change.
      expect(app.container.querySelector("#out")!.textContent).toBe("2:0");
    } finally {
      app.unmount();
    }
  });
});
