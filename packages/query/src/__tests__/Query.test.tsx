import { Component, Hook, state } from "@ramonda/core";
import type { RamondaNode, VNode } from "@ramonda/core";
import { act, render } from "@ramonda/testing-library";
import { describe, expect, test, vi } from "vitest";
import { QueryClientProvider } from "../context";
import { Query } from "../Query";
import { QueryClient } from "../QueryClient";

interface User {
  name: string;
}

/** Resolves when the test says so, so a pending render can be asserted on. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Commits everything already scheduled.
 *
 * `act` alone does this — with an async callback it gives the continuations ten
 * microtask turns and flushes after each — so this is a name, not a mechanism. What
 * it does NOT do is wait for a timer or a real round trip; that is `waitFor`, and
 * `Ssr.test.tsx` uses it where it matters.
 */
const settle = () => act(async () => {});

describe("Query", () => {
  test("renders pending, then the data", async () => {
    const gate = deferred<User>();

    class UserCard extends Component {
      private query = this.use(QueryClientProvider);
      private user = this.use(Query, () => ({
        key: ["user", 1],
        fetch: () => gate.promise,
      }));

      render(): RamondaNode {
        if (this.user.isPending) return <p id="out">pending</p>;
        return <p id="out">{this.user.data?.name}</p>;
      }
    }

    const { container, unmount } = render((<UserCard />) as VNode);
    try {
      expect(container.querySelector("#out")!.textContent).toBe("pending");

      gate.resolve({ name: "ada" });
      await settle();

      expect(container.querySelector("#out")!.textContent).toBe("ada");
    } finally {
      unmount();
    }
  });

  test("TData is inferred from the fetcher, with nothing declared", async () => {
    class UserCard extends Component {
      private query = this.use(QueryClientProvider);
      private user = this.use(Query, () => ({
        key: ["user", 1],
        fetch: async (): Promise<User> => ({ name: "ada" }),
      }));

      /**
       * The compile-time half of this test: annotated as `User`, so a `TData` that
       * came out as `unknown` fails to type-check rather than widening silently.
       */
      get name(): string | undefined {
        return this.user.data?.name;
      }

      render(): RamondaNode {
        return <p id="out">{this.name ?? "…"}</p>;
      }
    }

    const { container, unmount } = render((<UserCard />) as VNode);
    try {
      await settle();
      expect(container.querySelector("#out")!.textContent).toBe("ada");
    } finally {
      unmount();
    }
  });

  test("`result` narrows the data", async () => {
    const seen: string[] = [];

    class UserCard extends Component {
      private query = this.use(QueryClientProvider);
      private user = this.use(Query, () => ({
        key: ["user", 1],
        fetch: async (): Promise<User> => ({ name: "ada" }),
      }));

      render(): RamondaNode {
        const result = this.user.result;
        if (result.status === "success") {
          // No `!` and no `?.` — the union is what makes this legal.
          seen.push(result.data.name);
        }
        return <p id="out">{result.status}</p>;
      }
    }

    const { container, unmount } = render((<UserCard />) as VNode);
    try {
      await settle();
      expect(container.querySelector("#out")!.textContent).toBe("success");
      expect(seen).toEqual(["ada"]);
    } finally {
      unmount();
    }
  });

  test("two components asking for one key make one request", async () => {
    const fetcher = vi.fn(async () => "shared");

    class Reader extends Component {
      private value = this.use(Query, () => ({ key: ["shared"], fetch: fetcher }));
      render(): RamondaNode {
        return <span class="v">{this.value.data ?? "…"}</span>;
      }
    }

    class Page extends Component {
      private query = this.use(QueryClientProvider);
      render(): RamondaNode {
        return (
          <div>
            <Reader />
            <Reader />
          </div>
        );
      }
    }

    const { container, unmount } = render((<Page />) as VNode);
    try {
      await settle();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(Array.from(container.querySelectorAll(".v")).map((n) => n.textContent)).toEqual(["shared", "shared"]);
    } finally {
      unmount();
    }
  });

  test("a failure renders as an error, and the error survives", async () => {
    class Card extends Component {
      private query = this.use(QueryClientProvider, () => ({ defaults: { retry: 0 } }));
      private thing = this.use(Query, () => ({
        key: ["thing"],
        fetch: async (): Promise<string> => {
          throw new Error("no network");
        },
      }));

      render(): RamondaNode {
        if (this.thing.isError) return <p id="out">{(this.thing.error as Error).message}</p>;
        return <p id="out">{this.thing.status}</p>;
      }
    }

    const { container, unmount } = render((<Card />) as VNode);
    try {
      await settle();
      expect(container.querySelector("#out")!.textContent).toBe("no network");
    } finally {
      unmount();
    }
  });

  test("a key change shows the new key's state in the same render", async () => {
    const gates = new Map<number, ReturnType<typeof deferred<User>>>();
    const fetcher = vi.fn((id: number) => {
      let gate = gates.get(id);
      if (!gate) {
        gate = deferred<User>();
        gates.set(id, gate);
      }
      return gate.promise;
    });

    class Card extends Component {
      private query = this.use(QueryClientProvider);
      @state id = 1;
      private user = this.use(Query, (self: Card) => ({
        key: ["user", self.id],
        fetch: () => fetcher(self.id),
      }));

      render(): RamondaNode {
        return <p id="out">{this.user.data?.name ?? `pending:${this.id}`}</p>;
      }
    }

    const { container, unmount, instance } = render<Card>((<Card />) as VNode);
    try {
      gates.get(1)!.resolve({ name: "first" });
      await settle();
      expect(container.querySelector("#out")!.textContent).toBe("first");

      // The render caused by the key change must NOT still show user 1's name.
      act(() => {
        instance.id = 2;
      });
      expect(container.querySelector("#out")!.textContent).toBe("pending:2");

      await settle();
      gates.get(2)!.resolve({ name: "second" });
      await settle();
      expect(container.querySelector("#out")!.textContent).toBe("second");
    } finally {
      unmount();
    }
  });

  test("an unrelated re-render does not refetch", async () => {
    // The trap this locks down: driving the subscription from an @effect that
    // reads `props.key` re-runs on every owner render, because the key is a fresh
    // array literal each time — so an unrelated state change would abort the
    // request in flight and start another.
    const fetcher = vi.fn(async () => "once");

    class Card extends Component {
      private query = this.use(QueryClientProvider);
      @state unrelated = 0;
      private thing = this.use(Query, () => ({ key: ["thing"], fetch: fetcher }));

      render(): RamondaNode {
        return <p id="out">{`${this.thing.data ?? "…"}:${this.unrelated}`}</p>;
      }
    }

    const { container, unmount, instance } = render<Card>((<Card />) as VNode);
    try {
      await settle();
      expect(fetcher).toHaveBeenCalledTimes(1);

      act(() => {
        instance.unrelated = 1;
      });
      act(() => {
        instance.unrelated = 2;
      });
      await settle();

      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(container.querySelector("#out")!.textContent).toBe("once:2");
    } finally {
      unmount();
    }
  });

  test("a primitive key is not hashed on an unrelated re-render", async () => {
    /**
     * The performance claim, asserted rather than described.
     *
     * `hashKey` is `JSON.stringify` plus (in DEV) a recursive walk, and the naive
     * design ran it on every owner render just to learn the key had not moved:
     * measured at 723 ns per render per query for `["user", 42]`, against 31 ns for
     * the identity filter that replaced it.
     *
     * Counting `JSON.stringify` is the closest thing to a direct observation — the
     * hash is the only thing in this path that calls it.
     */
    class Card extends Component {
      private query = this.use(QueryClientProvider);
      @state unrelated = 0;
      private user = this.use(Query, (self: Card) => ({
        key: ["user", 42],
        fetch: async () => `v${self.unrelated}`,
      }));

      render(): RamondaNode {
        return <p id="out">{`${this.user.data ?? "…"}:${this.unrelated}`}</p>;
      }
    }

    const { unmount, instance } = render<Card>((<Card />) as VNode);
    try {
      await settle();

      const stringify = vi.spyOn(JSON, "stringify");
      try {
        act(() => {
          instance.unrelated = 1;
        });
        act(() => {
          instance.unrelated = 2;
        });
        expect(stringify).not.toHaveBeenCalled();
      } finally {
        stringify.mockRestore();
      }
    } finally {
      unmount();
    }
  });

  test("a key containing an object does not refetch on an unrelated re-render", async () => {
    /**
     * The case that decides how change detection has to work.
     *
     * `sameKeyParts` compares identities, and the `{ page }` literal is rebuilt on
     * every render — so the cheap filter says "different" every time. If that were
     * the verdict, this query would resubscribe and refetch on every unrelated state
     * change. It is only a filter: a `false` sends it to the hash, which says the
     * question has not moved.
     */
    const fetcher = vi.fn(async () => "page-1");

    class Table extends Component {
      private query = this.use(QueryClientProvider);
      @state unrelated = 0;
      @state page = 1;
      private rows = this.use(Query, (self: Table) => ({
        key: ["posts", { page: self.page, tag: "news" }],
        fetch: fetcher,
      }));

      render(): RamondaNode {
        return <p id="out">{`${this.rows.data ?? "…"}:${this.unrelated}`}</p>;
      }
    }

    const { container, unmount, instance } = render<Table>((<Table />) as VNode);
    try {
      await settle();
      expect(fetcher).toHaveBeenCalledTimes(1);

      act(() => {
        instance.unrelated = 1;
      });
      act(() => {
        instance.unrelated = 2;
      });
      await settle();

      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(container.querySelector("#out")!.textContent).toBe("page-1:2");
    } finally {
      unmount();
    }
  });

  test("a key containing an object DOES refetch when a value inside it changes", async () => {
    const seen: number[] = [];
    const fetcher = vi.fn(async (page: number) => {
      seen.push(page);
      return `page-${page}`;
    });

    class Table extends Component {
      private query = this.use(QueryClientProvider);
      @state page = 1;
      private rows = this.use(Query, (self: Table) => ({
        key: ["posts", { page: self.page }],
        fetch: () => fetcher(self.page),
      }));

      render(): RamondaNode {
        return <p id="out">{this.rows.data ?? `pending:${this.page}`}</p>;
      }
    }

    const { container, unmount, instance } = render<Table>((<Table />) as VNode);
    try {
      await settle();
      expect(container.querySelector("#out")!.textContent).toBe("page-1");

      act(() => {
        instance.page = 2;
      });
      // The new key's state is on screen in the render that changed it.
      expect(container.querySelector("#out")!.textContent).toBe("pending:2");

      await settle();
      expect(container.querySelector("#out")!.textContent).toBe("page-2");
      expect(seen).toEqual([1, 2]);
    } finally {
      unmount();
    }
  });

  test("a key whose object part is reordered is the same question", async () => {
    // The hash sorts object keys, so this is where that pays off from the observer's
    // side rather than the cache's.
    const fetcher = vi.fn(async () => "v");

    class Table extends Component {
      private query = this.use(QueryClientProvider);
      @state flipped = false;
      private rows = this.use(Query, (self: Table) => ({
        key: ["posts", self.flipped ? { tag: "a", page: 1 } : { page: 1, tag: "a" }],
        fetch: fetcher,
      }));

      render(): RamondaNode {
        return <p id="out">{this.rows.data ?? "…"}</p>;
      }
    }

    const { unmount, instance } = render<Table>((<Table />) as VNode);
    try {
      await settle();
      expect(fetcher).toHaveBeenCalledTimes(1);

      act(() => {
        instance.flipped = true;
      });
      await settle();

      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });

  test("`enabled: false` holds the query back", async () => {
    const fetcher = vi.fn(async () => "value");

    class Card extends Component {
      private query = this.use(QueryClientProvider);
      @state ready = false;
      private thing = this.use(Query, (self: Card) => ({
        key: ["thing"],
        fetch: fetcher,
        enabled: self.ready,
      }));

      render(): RamondaNode {
        return <p id="out">{this.thing.data ?? this.thing.status}</p>;
      }
    }

    const { container, unmount, instance } = render<Card>((<Card />) as VNode);
    try {
      await settle();
      expect(fetcher).not.toHaveBeenCalled();
      expect(container.querySelector("#out")!.textContent).toBe("pending");

      // Flipping it fetches. This works through an @effect that reads only
      // `enabled` — safe because a boolean signal compares by value, unlike the
      // key array.
      await act(async () => {
        instance.ready = true;
      });
      await settle();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(container.querySelector("#out")!.textContent).toBe("value");
    } finally {
      unmount();
    }
  });

  test("refetch fetches again even when the data is fresh", async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => `v${++calls}`);

    class Card extends Component {
      private query = this.use(QueryClientProvider, () => ({
        defaults: { staleTime: Number.POSITIVE_INFINITY },
      }));
      thing = this.use(Query, () => ({ key: ["thing"], fetch: fetcher }));

      render(): RamondaNode {
        return <p id="out">{this.thing.data ?? "…"}</p>;
      }
    }

    const { container, unmount, instance } = render<Card>((<Card />) as VNode);
    try {
      await settle();
      expect(container.querySelector("#out")!.textContent).toBe("v1");

      await act(async () => {
        await instance.thing.refetch();
      });
      expect(container.querySelector("#out")!.textContent).toBe("v2");
    } finally {
      unmount();
    }
  });

  test("invalidating from outside refetches whoever is watching", async () => {
    let calls = 0;
    const client = new QueryClient({ defaults: { staleTime: Number.POSITIVE_INFINITY } });

    class Card extends Component {
      private query = this.use(QueryClientProvider, () => ({ client }));
      private thing = this.use(Query, () => ({
        key: ["thing"],
        fetch: async () => `v${++calls}`,
      }));

      render(): RamondaNode {
        return <p id="out">{this.thing.data ?? "…"}</p>;
      }
    }

    const { container, unmount } = render((<Card />) as VNode);
    try {
      await settle();
      expect(container.querySelector("#out")!.textContent).toBe("v1");

      await act(async () => {
        client.invalidate(["thing"]);
        await Promise.resolve();
      });
      await settle();

      expect(container.querySelector("#out")!.textContent).toBe("v2");
    } finally {
      unmount();
    }
  });

  test("client.remove() reaches a live observer, which starts over", async () => {
    /**
     * The logout case, and a bug the entry cache forced into the open.
     *
     * An observer holds the entry it subscribed to, so the read path never hashes.
     * `remove` DELETES that entry — and before it announced itself, the observer was
     * left subscribed to a discarded object: never notified again, still rendering
     * the departed user's data. (Uncached it was no better: `getEntry` minted a fresh
     * entry for the render while the subscription stayed on the old one, so the
     * component showed "pending" and then never heard another thing.)
     */
    let calls = 0;
    const client = new QueryClient({ defaults: { staleTime: Number.POSITIVE_INFINITY } });

    class Card extends Component {
      private provider = this.use(QueryClientProvider, () => ({ client }));
      private me = this.use(Query, () => ({
        key: ["me"],
        fetch: async () => `session-${++calls}`,
      }));
      render(): RamondaNode {
        return <p id="out">{this.me.data ?? "signed-out"}</p>;
      }
    }

    const { container, unmount } = render((<Card />) as VNode);
    try {
      await settle();
      expect(container.querySelector("#out")!.textContent).toBe("session-1");

      await act(async () => {
        client.remove(["me"]);
        await Promise.resolve();
      });
      await settle();

      // Re-subscribed to a fresh entry and fetched again, rather than holding the
      // deleted one forever.
      expect(calls).toBe(2);
      expect(container.querySelector("#out")!.textContent).toBe("session-2");
      expect(client.peek(["me"])!.observers.size).toBe(1);
    } finally {
      unmount();
    }
  });

  test("unmounting removes the observer, so the entry can be collected", async () => {
    const client = new QueryClient({ defaults: { gcTime: 0 } });

    class Card extends Component {
      private query = this.use(QueryClientProvider, () => ({ client }));
      private thing = this.use(Query, () => ({ key: ["thing"], fetch: async () => "v" }));
      render(): RamondaNode {
        return <p>{this.thing.data ?? "…"}</p>;
      }
    }

    const { unmount } = render((<Card />) as VNode);
    await settle();
    expect(client.peek(["thing"])!.observers.size).toBe(1);

    unmount();
    expect(client.peek(["thing"])?.observers.size ?? 0).toBe(0);

    // gcTime 0 → the next observer walking past collects it.
    client.subscribe(["something-else"], () => {});
    expect(client.peek(["thing"])).toBeUndefined();
  });

  test("a query without a provider says what is missing", () => {
    class Orphan extends Component {
      private thing = this.use(Query, () => ({ key: ["thing"], fetch: async () => "v" }));
      render(): RamondaNode {
        return <p>{this.thing.data ?? "…"}</p>;
      }
    }

    // Silenced: core reports the missing provider as RMD003 on its own (a
    // context read with no Provider above it), and the throw below is the part
    // being asserted.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render((<Orphan />) as VNode)).toThrow(/QueryClientProvider/);
    } finally {
      error.mockRestore();
    }
  });

  test("a query works inside a hook, not only a component", async () => {
    class UserData extends Hook<{ id: number }> {
      private user = this.use(Query, (self: UserData) => ({
        key: ["user", self.props.id],
        fetch: async (): Promise<User> => ({ name: `user-${self.props.id}` }),
      }));

      get label(): string {
        return this.user.data?.name ?? "…";
      }
    }

    class Card extends Component {
      private query = this.use(QueryClientProvider);
      private data = this.use(UserData, { id: 3 });
      render(): RamondaNode {
        return <p id="out">{this.data.label}</p>;
      }
    }

    const { container, unmount } = render((<Card />) as VNode);
    try {
      await settle();
      expect(container.querySelector("#out")!.textContent).toBe("user-3");
    } finally {
      unmount();
    }
  });
});
