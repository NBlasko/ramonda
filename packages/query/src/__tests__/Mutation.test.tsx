import { Component } from "@ramonda/core";
import type { RamondaNode, VNode } from "@ramonda/core";
import { act, render } from "@ramonda/testing-library";
import { describe, expect, test, vi } from "vitest";
import { Mutation, type MutationContext } from "../Mutation";
import { mutationOptions } from "../options";
import { Query } from "../Query";
import { QueryClient } from "../QueryClient";
import { QueryClientProvider } from "../context";

interface Todo {
  title: string;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("Mutation", () => {
  test("idle → pending → success, and the data is readable", async () => {
    const gate = deferred<Todo>();

    class Form extends Component {
      private provider = this.use(QueryClientProvider);
      add = this.use(Mutation, () => ({
        mutate: (_title: string) => gate.promise,
      }));

      render(): RamondaNode {
        if (this.add.isPending) return <p id="out">saving</p>;
        if (this.add.isSuccess) return <p id="out">{this.add.data?.title}</p>;
        return <p id="out">idle</p>;
      }
    }

    const { container, unmount, instance } = render<Form>((<Form />) as VNode);
    try {
      expect(container.querySelector("#out")!.textContent).toBe("idle");

      act(() => instance.add.mutate("write tests"));
      expect(container.querySelector("#out")!.textContent).toBe("saving");

      gate.resolve({ title: "write tests" });
      await settle();
      expect(container.querySelector("#out")!.textContent).toBe("write tests");
    } finally {
      unmount();
    }
  });

  test("a failure lands on `error` and does not reject out of `mutate`", async () => {
    class Form extends Component {
      private provider = this.use(QueryClientProvider);
      add = this.use(Mutation, () => ({
        mutate: async (_title: string): Promise<Todo> => {
          throw new Error("409 conflict");
        },
      }));

      render(): RamondaNode {
        return <p id="out">{this.add.isError ? (this.add.error as Error).message : "idle"}</p>;
      }
    }

    const { container, unmount, instance } = render<Form>((<Form />) as VNode);
    try {
      // A click handler must not have to catch: an unhandled rejection there is a
      // console error the user cannot act on.
      act(() => instance.add.mutate("x"));
      await settle();
      expect(container.querySelector("#out")!.textContent).toBe("409 conflict");
    } finally {
      unmount();
    }
  });

  test("`mutateAsync` rejects, so a caller can await it", async () => {
    class Form extends Component {
      private provider = this.use(QueryClientProvider);
      add = this.use(Mutation, () => ({
        mutate: async (_title: string): Promise<Todo> => {
          throw new Error("nope");
        },
      }));
      render(): RamondaNode {
        return <p />;
      }
    }

    const { unmount, instance } = render<Form>((<Form />) as VNode);
    try {
      await expect(instance.add.mutateAsync("x")).rejects.toThrow("nope");
      await settle();
      expect(instance.add.isError).toBe(true);
    } finally {
      unmount();
    }
  });

  test("callbacks run in order, with the client in hand", async () => {
    const order: string[] = [];

    class Form extends Component {
      private provider = this.use(QueryClientProvider);
      // Through `mutationOptions`, so `data`, `vars` and `ctx` are typed with no
      // annotations — the options are CHECKED against MutationProps here instead of
      // being what the type is inferred from. See options.ts.
      add = this.use(Mutation, () =>
        mutationOptions({
          mutate: async (title: string): Promise<Todo> => ({ title }),
          onMutate: () => {
            order.push("mutate");
          },
          onSuccess: (data, vars, ctx) => {
            order.push(`success:${data.title}:${vars}:${typeof ctx.client.invalidate}`);
          },
          onSettled: () => {
            order.push("settled");
          },
        }),
      );
      render(): RamondaNode {
        return <p />;
      }
    }

    const { unmount, instance } = render<Form>((<Form />) as VNode);
    try {
      await act(async () => {
        await instance.add.mutateAsync("t");
      });
      expect(order).toEqual(["mutate", "success:t:t:function", "settled"]);
    } finally {
      unmount();
    }
  });

  test("`invalidates` refetches the queries that were watching", async () => {
    let calls = 0;
    const client = new QueryClient({ defaults: { staleTime: Number.POSITIVE_INFINITY } });

    class Page extends Component {
      private provider = this.use(QueryClientProvider, () => ({ client }));
      private todos = this.use(Query, () => ({
        key: ["todos"],
        fetch: async () => `list-${++calls}`,
      }));
      add = this.use(Mutation, () => ({
        mutate: async (title: string): Promise<Todo> => ({ title }),
        invalidates: [["todos"]],
      }));

      render(): RamondaNode {
        return <p id="out">{this.todos.data ?? "…"}</p>;
      }
    }

    const { container, unmount, instance } = render<Page>((<Page />) as VNode);
    try {
      await settle();
      expect(container.querySelector("#out")!.textContent).toBe("list-1");

      await act(async () => {
        await instance.add.mutateAsync("t");
      });
      await settle();

      // Invalidation marks the data stale and asks the observer to refetch — with
      // the observer's own fetcher, not one the cache kept a reference to.
      expect(container.querySelector("#out")!.textContent).toBe("list-2");
    } finally {
      unmount();
    }
  });

  test("an optimistic update is rolled back when the mutation fails", async () => {
    const client = new QueryClient({ defaults: { staleTime: Number.POSITIVE_INFINITY } });

    class Page extends Component {
      private provider = this.use(QueryClientProvider, () => ({ client }));
      private todos = this.use(Query, () => ({
        key: ["todos"],
        fetch: async (): Promise<string[]> => ["first"],
      }));
      add = this.use(Mutation, () => ({
        mutate: async (_title: string): Promise<Todo> => {
          throw new Error("rejected");
        },
        // The same "return the cleanup" contract as @effect: what comes back is the
        // rollback, and the framework calls it if the write fails.
        onMutate: (title: string, { client: c }: MutationContext) => {
          const previous = c.peek<string[]>(["todos"])?.data;
          c.setData<string[]>(["todos"], (todos) => [...(todos ?? []), title]);
          return () => c.setData<string[]>(["todos"], previous ?? []);
        },
      }));

      render(): RamondaNode {
        return <p id="out">{(this.todos.data ?? []).join(",")}</p>;
      }
    }

    const { container, unmount, instance } = render<Page>((<Page />) as VNode);
    try {
      await settle();
      expect(container.querySelector("#out")!.textContent).toBe("first");

      act(() => instance.add.mutate("second"));
      // Optimistic: on screen before the request has answered.
      expect(container.querySelector("#out")!.textContent).toBe("first,second");

      await settle();
      expect(container.querySelector("#out")!.textContent).toBe("first");
      expect(instance.add.isError).toBe(true);
    } finally {
      unmount();
    }
  });

  test("an optimistic update survives a successful mutation", async () => {
    const client = new QueryClient({ defaults: { staleTime: Number.POSITIVE_INFINITY } });
    const rollback = vi.fn();

    class Page extends Component {
      private provider = this.use(QueryClientProvider, () => ({ client }));
      private todos = this.use(Query, () => ({
        key: ["todos"],
        fetch: async (): Promise<string[]> => ["first"],
      }));
      add = this.use(Mutation, () => ({
        mutate: async (title: string): Promise<Todo> => ({ title }),
        onMutate: (title: string, { client: c }: MutationContext) => {
          c.setData<string[]>(["todos"], (todos) => [...(todos ?? []), title]);
          return rollback;
        },
      }));

      render(): RamondaNode {
        return <p id="out">{(this.todos.data ?? []).join(",")}</p>;
      }
    }

    const { container, unmount, instance } = render<Page>((<Page />) as VNode);
    try {
      await settle();
      await act(async () => {
        await instance.add.mutateAsync("second");
      });
      await settle();

      expect(rollback).not.toHaveBeenCalled();
      expect(container.querySelector("#out")!.textContent).toBe("first,second");
    } finally {
      unmount();
    }
  });

  test("the rollback runs even if the component unmounted first", async () => {
    // The cache outlives the hook, so an optimistic value left in it because the
    // component went away is a todo the server rejected, still on the next screen.
    const client = new QueryClient({ defaults: { staleTime: Number.POSITIVE_INFINITY } });
    const gate = deferred<Todo>();

    class Page extends Component {
      private provider = this.use(QueryClientProvider, () => ({ client }));
      add = this.use(Mutation, () => ({
        mutate: (_title: string) => gate.promise,
        onMutate: (title: string, { client: c }: MutationContext) => {
          const previous = c.peek<string[]>(["todos"])?.data;
          c.setData<string[]>(["todos"], (todos) => [...(todos ?? []), title]);
          return () => c.setData<string[]>(["todos"], previous ?? []);
        },
      }));
      render(): RamondaNode {
        return <p />;
      }
    }

    client.setData<string[]>(["todos"], ["first"]);

    const { unmount, instance } = render<Page>((<Page />) as VNode);
    act(() => instance.add.mutate("second"));
    expect(client.peek<string[]>(["todos"])!.data).toEqual(["first", "second"]);

    unmount();
    gate.reject(new Error("rejected"));
    await settle();

    expect(client.peek<string[]>(["todos"])!.data).toEqual(["first"]);
  });

  test("a second call in flight owns the state; the first cannot land over it", async () => {
    const first = deferred<Todo>();
    const second = deferred<Todo>();
    const gates = [first, second];

    class Form extends Component {
      private provider = this.use(QueryClientProvider);
      add = this.use(Mutation, () => ({
        mutate: (_title: string) => gates.shift()!.promise,
      }));
      render(): RamondaNode {
        return <p id="out">{this.add.data?.title ?? (this.add.isPending ? "pending" : "idle")}</p>;
      }
    }

    const { unmount, instance } = render<Form>((<Form />) as VNode);
    try {
      act(() => instance.add.mutate("a"));
      act(() => instance.add.mutate("b"));

      // The later call settles first, then the earlier one arrives.
      second.resolve({ title: "b" });
      await settle();
      first.resolve({ title: "a" });
      await settle();

      expect(instance.add.data?.title).toBe("b");
    } finally {
      unmount();
    }
  });

  test("two successes in a row both re-render", async () => {
    // `status` writes "success" over "success" and the signal compares equal, so
    // without the counter the second result would never reach the screen.
    let calls = 0;

    class Form extends Component {
      private provider = this.use(QueryClientProvider);
      add = this.use(Mutation, () => ({
        mutate: async (): Promise<Todo> => ({ title: `saved-${++calls}` }),
      }));
      render(): RamondaNode {
        return <p id="out">{this.add.data?.title ?? "idle"}</p>;
      }
    }

    const { container, unmount, instance } = render<Form>((<Form />) as VNode);
    try {
      await act(async () => {
        await instance.add.mutateAsync();
      });
      expect(container.querySelector("#out")!.textContent).toBe("saved-1");

      await act(async () => {
        await instance.add.mutateAsync();
      });
      expect(container.querySelector("#out")!.textContent).toBe("saved-2");
    } finally {
      unmount();
    }
  });

  test("reset puts it back to idle", async () => {
    class Form extends Component {
      private provider = this.use(QueryClientProvider);
      add = this.use(Mutation, () => ({
        mutate: async (): Promise<Todo> => {
          throw new Error("nope");
        },
      }));
      render(): RamondaNode {
        return <p id="out">{this.add.isError ? "error" : this.add.isIdle ? "idle" : "other"}</p>;
      }
    }

    const { container, unmount, instance } = render<Form>((<Form />) as VNode);
    try {
      act(() => instance.add.mutate());
      await settle();
      expect(container.querySelector("#out")!.textContent).toBe("error");

      act(() => instance.add.reset());
      expect(container.querySelector("#out")!.textContent).toBe("idle");
      expect(instance.add.error).toBeUndefined();
    } finally {
      unmount();
    }
  });

  test("a mutation without a provider says what is missing", () => {
    class Orphan extends Component {
      add = this.use(Mutation, () => ({
        mutate: async (): Promise<Todo> => ({ title: "x" }),
      }));
      render(): RamondaNode {
        return <p />;
      }
    }

    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { unmount, instance } = render<Orphan>((<Orphan />) as VNode);
      try {
        expect(() => instance.add.mutate()).toThrow(/QueryClientProvider/);
      } finally {
        unmount();
      }
    } finally {
      logs.mockRestore();
    }
  });
});
