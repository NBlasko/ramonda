import { Component, compute, state } from "@ramonda/core";
import { act, render } from "@ramonda/testing-library";
import { describe, expect, test } from "vitest";
import { QueryClientProvider } from "../context";
import { Query } from "../Query";

/**
 * A `@compute` that reads a query must track it.
 *
 * It did not, and the failure was silent: the cache is not reactive — an entry is a plain
 * object, and what wakes an observer is the `version` increment in `notify`. A render re-reads
 * the getters every time so it always looked right, but a compute caches, and a compute that
 * read no signal is never invalidated. Measured before the fix: the compute returned
 * `undefined` forever while the render, reading `data` directly, showed the fourth refetch's
 * value.
 *
 * The fix is one signal read inside the `entry` getter, so every reader depends on the one
 * thing that changes when the entry does. These tests are what keeps it there.
 */

const settle = () => act(async () => {});

interface User {
  name: string;
  visits: number;
}

describe("a @compute over a query", () => {
  test("follows the data instead of freezing on the first value", async () => {
    let visits = 0;
    let computeRuns = 0;
    let renders = 0;

    class Card extends Component {
      private provider = this.use(QueryClientProvider);
      user = this.use(Query, () => ({
        key: ["user"],
        fetch: async (): Promise<User> => ({ name: `Ada ${++visits}`, visits }),
      }));

      @compute get label(): string {
        computeRuns++;
        return this.user.data?.name ?? "—";
      }

      render() {
        renders++;
        void this.provider;
        return <span id="out">{`${this.label}|${this.user.data?.name ?? "—"}`}</span>;
      }
    }

    const { container, instance, unmount } = render(<Card />);
    try {
      await settle();
      // The compute agrees with a direct read. Before the fix the first half read `—`.
      expect(container.querySelector("#out")!.textContent).toBe("Ada 1|Ada 1");

      for (let i = 0; i < 3; i++) {
        await act(async () => {
          await (instance as { user: Query<User> }).user.refetch();
        });
      }

      expect(container.querySelector("#out")!.textContent).toBe("Ada 4|Ada 4");
      // And it really recomputed rather than being read past — one run per render.
      expect(computeRuns).toBe(renders);
    } finally {
      unmount();
    }
  });

  test("reading the query costs no extra render", async () => {
    let renders = 0;

    class Card extends Component {
      private provider = this.use(QueryClientProvider);
      @state tick = 0;
      user = this.use(Query, () => ({ key: ["once"], fetch: async () => "Ada" }));

      @compute get label(): string {
        return this.user.data ?? "—";
      }

      render() {
        renders++;
        void this.provider;
        return <span>{`${this.label}:${this.tick}`}</span>;
      }
    }

    const { instance, unmount } = render(<Card />);
    try {
      await settle();
      const afterLoad = renders;

      await act(async () => {
        (instance as { tick: number }).tick = 1;
      });
      await settle();

      /**
       * The version signal the getters read is the SAME one that wakes the observer, so
       * depending on it adds no scheduling of its own: one unrelated state change, one render.
       */
      expect(renders).toBe(afterLoad + 1);
    } finally {
      unmount();
    }
  });

  test("a @compute over a query that never loads stays at its fallback, and then follows", async () => {
    let resolve!: (value: string) => void;
    const gate = new Promise<string>((r) => {
      resolve = r;
    });

    class Card extends Component {
      private provider = this.use(QueryClientProvider);
      user = this.use(Query, () => ({ key: ["gated"], fetch: () => gate }));

      @compute get label(): string {
        return this.user.data ?? "loading";
      }

      render() {
        void this.provider;
        return <span id="out">{this.label}</span>;
      }
    }

    const { container, unmount } = render(<Card />);
    try {
      await settle();
      // The pending case is where the freeze used to be permanent: the compute cached
      // `undefined` before the data existed and never looked again.
      expect(container.querySelector("#out")!.textContent).toBe("loading");

      await act(async () => {
        resolve("Ada");
        await gate;
      });
      await settle();

      expect(container.querySelector("#out")!.textContent).toBe("Ada");
    } finally {
      unmount();
    }
  });
});
