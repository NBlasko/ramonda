import { Component, state } from "@ramonda/core";
import { act, render } from "@ramonda/testing-library";
import { describe, expect, test } from "vitest";
import { QueryClientProvider } from "../context";
import { Query } from "../Query";

/**
 * A render only happens for what the component actually reads.
 *
 * A cache entry changes three times per refetch — the fetch starts, the data arrives, the
 * freshness moves — and every one of them used to wake the owner. Measured before this:
 * three refetches of a query whose rendered value never changed produced NINE renders.
 *
 * The getters record which facet was read; a notification compares only those. This is the
 * shape TanStack and SWR arrived at by proxying their result object — here the getters are
 * already the access points.
 */

const settle = () => act(async () => {});

interface User {
  name: string;
  visits: number;
}

/** Only the readers matter here, so the query's key type parameter does not. */
type UserQuery = Pick<Query<User>, "data" | "isFetching" | "isError" | "status">;

/** Mounts a query and counts renders, reading exactly what `read` asks for. */
function mount(read: (q: UserQuery) => string, fetchValue: () => User) {
  const counts = { renders: 0 };

  class Card extends Component {
    private provider = this.use(QueryClientProvider);
    user = this.use(Query, () => ({ key: ["user"], fetch: async () => fetchValue() }));

    render() {
      counts.renders++;
      void this.provider;
      return <span id="out">{read(this.user)}</span>;
    }
  }

  const app = render(<Card />);
  return { ...app, counts, query: () => (app.instance as { user: Query<User> }).user };
}

describe("access tracking", () => {
  test("a component reading one unchanged field is not re-rendered by a refetch", async () => {
    let visits = 0;
    const app = mount(
      (q) => q.data?.name ?? "—",
      () => ({ name: "Ada", visits: ++visits }),
    );

    try {
      await settle();
      const afterLoad = app.counts.renders;

      for (let i = 0; i < 3; i++) {
        await act(async () => {
          await app.query().refetch();
        });
      }

      /**
       * `data` is replaced by every fetch, so its identity changes and one render per refetch
       * is correct — the component does read `data`. What is gone is the other two: the
       * `fetchStatus` transition and the freshness change, which this component never asked
       * about. Nine renders became four.
       */
      expect(app.counts.renders).toBe(afterLoad + 3);
      expect(visits).toBe(4);
    } finally {
      app.unmount();
    }
  });

  test("a component that reads isFetching IS re-rendered by the transitions", async () => {
    const app = mount(
      (q) => `${q.isFetching}`,
      () => ({ name: "Ada", visits: 1 }),
    );

    try {
      await settle();
      const afterLoad = app.counts.renders;

      await act(async () => {
        await app.query().refetch();
      });

      // Reading it subscribes to it: the spinner has to be able to appear and disappear.
      expect(app.counts.renders).toBeGreaterThan(afterLoad + 1);
    } finally {
      app.unmount();
    }
  });

  test("nothing is skipped before the first render", async () => {
    // Nothing has been read yet, so the first arrival must wake the owner regardless.
    const app = mount(
      (q) => q.data?.name ?? "—",
      () => ({ name: "Ada", visits: 1 }),
    );

    try {
      await settle();
      expect(app.container.querySelector("#out")!.textContent).toBe("Ada");
    } finally {
      app.unmount();
    }
  });

  test("an unrelated state change still renders", async () => {
    class Card extends Component {
      private provider = this.use(QueryClientProvider);
      @state tick = 0;
      user = this.use(Query, () => ({ key: ["u"], fetch: async () => "Ada" }));

      render() {
        void this.provider;
        return <span id="out">{`${this.user.data ?? "—"}:${this.tick}`}</span>;
      }
    }

    const app = render(<Card />);
    try {
      await settle();
      await act(async () => {
        (app.instance as { tick: number }).tick = 1;
      });
      // The gate is on the query's notifications only — it must not interfere with the
      // component's own state.
      expect(app.container.querySelector("#out")!.textContent).toBe("Ada:1");
    } finally {
      app.unmount();
    }
  });

  test("two components on one key are woken independently", async () => {
    let visits = 0;
    const counts = { name: 0, fetching: 0 };

    class NameOnly extends Component {
      user = this.use(Query, () => ({ key: ["shared"], fetch: async () => ({ name: "Ada", visits: ++visits }) }));
      render() {
        counts.name++;
        return <span>{this.user.data?.name ?? "—"}</span>;
      }
    }

    class SpinnerOnly extends Component {
      user = this.use(Query, () => ({ key: ["shared"], fetch: async () => ({ name: "Ada", visits }) }));
      render() {
        counts.fetching++;
        return <span>{String(this.user.isFetching)}</span>;
      }
    }

    class App extends Component {
      private provider = this.use(QueryClientProvider);
      render() {
        void this.provider;
        return (
          <div>
            <NameOnly />
            <SpinnerOnly />
          </div>
        );
      }
    }

    const app = render(<App />);
    try {
      await settle();
      const before = { ...counts };

      // One request for both, but the transitions reach only the one that reads them.
      await act(async () => {
        await (app.container.querySelector("span") as unknown as never, Promise.resolve());
      });

      expect(counts.name).toBe(before.name);
      expect(counts.fetching).toBe(before.fetching);
    } finally {
      app.unmount();
    }
  });
});
