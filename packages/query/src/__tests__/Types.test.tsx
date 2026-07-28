import { Component } from "@ramonda/core";
import type { RamondaNode, VNode } from "@ramonda/core";
import { render } from "@ramonda/testing-library";
import { describe, expect, test } from "vitest";
import { Mutation, type MutationContext } from "../Mutation";
import { mutationOptions, queryOptions } from "../options";
import { Query } from "../Query";
import { QueryClientProvider } from "../context";
import type { FetchContext } from "../types";

/**
 * The type-level tripwires. Most of this file is checked by `pnpm check-types`
 * rather than by running — it fails by not compiling.
 *
 * Two things are pinned here, and the second is a LIMITATION deliberately written
 * down as a `@ts-expect-error`, so it also fails if it ever stops being true.
 */

interface Todo {
  id: number;
  title: string;
}

declare function getTodo(id: number, options: { signal: AbortSignal }): Promise<Todo>;
declare function createTodo(title: string): Promise<Todo>;

/** 1. `TData` is inferred from `fetch`, with nothing declared at the call site. */
class Inferred extends Component<{ id: number }> {
  private todo = this.use(Query, (self: Inferred) => ({
    key: ["todo", self.props.id],
    // Annotated, because the props object is what the type is INFERRED FROM — see
    // the `Limitation` case below, and `queryOptions` for the alternative.
    fetch: ({ signal }: FetchContext) => getTodo(self.props.id, { signal }),
  }));

  /** Annotated as `Todo`, so a `TData` of `unknown` fails to compile here. */
  get title(): string | undefined {
    return this.todo.data?.title;
  }

  render(): RamondaNode {
    return <p id="out">{this.title ?? "…"}</p>;
  }
}

/**
 * 2. The limitation, pinned so it cannot change unnoticed.
 *
 * `Q` is inferred FROM the props object, so the object is the source of the
 * inference rather than something checked against a target type — and a callback
 * parameter left unannotated therefore has no contextual type. The fix is either an
 * annotation (above) or `queryOptions` (below); this exists to document that the
 * plain form really does need one.
 */
class Limitation extends Component {
  private todo = this.use(Query, () => ({
    key: ["todo", 1],
    // @ts-expect-error 'signal' implicitly has an 'any' type — see queryOptions.
    fetch: ({ signal }) => getTodo(1, { signal }),
  }));

  render(): RamondaNode {
    return <p>{this.todo.status}</p>;
  }
}

/** 3. `queryOptions` reverses the direction, and every parameter is typed. */
class WithHelper extends Component<{ id: number }> {
  private todo = this.use(Query, (self: WithHelper) =>
    queryOptions({
      key: ["todo", self.props.id] as const,
      // Both typed with no annotation: `signal` from `FetchContext`, and `key`
      // from the key type itself — so `key[1]` is a number, not `unknown`.
      fetch: ({ signal, key }) => getTodo(key[1], { signal }),
    }),
  );

  get title(): string | undefined {
    return this.todo.data?.title;
  }

  render(): RamondaNode {
    return <p id="out">{this.title ?? "…"}</p>;
  }
}

/** 4. `mutationOptions` does the same for a mutation's callbacks. */
class MutationTypes extends Component {
  private add = this.use(Mutation, () =>
    mutationOptions({
      mutate: (title: string) => createTodo(title),
      onSuccess: (todo, title, { client }) => {
        // `todo` is Todo, `title` is string, `client` is a QueryClient.
        client.setData(["todo", todo.id], todo);
        void title.length;
      },
      onMutate: (title, { client }) => {
        void client;
        void title.length;
        return () => {};
      },
      invalidates: [["todos"]],
    }),
  );

  /** Annotated, so a `TData` of `unknown` fails to compile. */
  get created(): Todo | undefined {
    return this.add.data;
  }

  render(): RamondaNode {
    return <p>{this.created?.title ?? "…"}</p>;
  }
}

/** 5. `result` narrows; the boolean getters cannot, which is why both exist. */
class Narrowing extends Component {
  private todo = this.use(Query, () =>
    queryOptions({
      key: ["todo", 1],
      fetch: ({ signal }) => getTodo(1, { signal }),
    }),
  );

  render(): RamondaNode {
    const result = this.todo.result;
    if (result.status === "success") {
      // No `!`, no `?.` — this line is the assertion.
      const title: string = result.data.title;
      return <p id="out">{title}</p>;
    }
    if (result.status === "error") {
      return <p id="out">failed</p>;
    }
    return <p id="out">pending</p>;
  }
}

/** A mutation context annotation is enough when the helper is not wanted. */
class AnnotatedContext extends Component {
  private add = this.use(Mutation, () => ({
    mutate: (title: string) => createTodo(title),
    onMutate: (_title: string, { client }: MutationContext) => {
      void client;
    },
  }));

  render(): RamondaNode {
    return <p>{this.add.isPending ? "…" : "idle"}</p>;
  }
}

describe("typing", () => {
  test("the inferred and the helper form render the same way", () => {
    // The runtime half is thin on purpose: what this file is really asserting is
    // that it compiles. Mounting each shape once keeps it honest — a class that
    // type-checks but throws on construction would still be a broken API.
    class Page extends Component {
      private provider = this.use(QueryClientProvider);
      render(): RamondaNode {
        return (
          <div>
            <Inferred id={1} />
            <Limitation />
            <WithHelper id={1} />
            <MutationTypes />
            <Narrowing />
            <AnnotatedContext />
          </div>
        );
      }
    }

    const { container, unmount } = render((<Page />) as VNode);
    try {
      expect(container.querySelectorAll("#out").length).toBeGreaterThan(0);
    } finally {
      unmount();
    }
  });
});
