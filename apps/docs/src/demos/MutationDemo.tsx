import { Component, Host, list, onElement, stable, state } from "@ramonda/core";
import { Mutation, Query, QueryClient, QueryClientProvider, mutationOptions, queryOptions } from "@ramonda/query";

// The "server": a list, and a rule that rejects anything already there. The
// rejection is what makes the rollback visible.
let todos = ["write the docs"];

/**
 * One array for "nothing yet", because `each: this.list.data ?? []` would build a fresh
 * empty array on every render while the query is pending — a changed `each`, which costs
 * the list its row identities. RMD020 reports it.
 */
const NONE: string[] = [];

function loadTodos(): Promise<string[]> {
  return new Promise((resolve) => setTimeout(() => resolve([...todos]), 300));
}

function createTodo(title: string): Promise<string> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (todos.includes(title)) {
        reject(new Error(`"${title}" is already on the list`));
        return;
      }
      todos = [...todos, title];
      resolve(title);
    }, 500);
  });
}

/**
 * Optimistic: the item is on screen before the request answers. What this returns is the
 * ROLLBACK — the same "return the cleanup" contract `@effect` and
 * `createSubscriptionDecorator` use — and it runs only if the mutation fails.
 *
 * A module function, so its identity never changes. Declared inline it would be a fresh
 * closure on every render of the owner, which is a changed prop (RMD022) — and it needs
 * nothing from the component, only what the mutation hands it.
 */
function optimisticAdd(title: string, { client }: { client: QueryClient }): () => void {
  const previous = client.peek<string[]>(["todos"])?.data;
  client.setData<string[]>(["todos"], (list) => [...(list ?? []), title]);
  return () => client.setData<string[]>(["todos"], previous ?? []);
}

// The host IS the form, and that is not decoration: `@onElement` listens on the
// component's HOST element, so a `submit` handler needs the host to be the thing
// that emits `submit`. With the default host it would only work by bubbling — and
// only if a <form> happened to be inside.
@Host("form")
export class MutationDemo extends Component {
  private query = this.use(QueryClientProvider);

  @state draft = "";

  private list = this.use(Query, () =>
    queryOptions({
      // `stable()` and bound methods, because the callback runs on every render: a fresh
      // array or closure is a changed prop, and RMD022 reports it. See the diagnostics
      // reference for what it costs.
      key: stable(["todos"]),
      fetch: loadTodos,
      staleTime: 10_000,
    }),
  );

  private add = this.use(Mutation, () =>
    mutationOptions({
      mutate: createTodo,
      onMutate: optimisticAdd,
      // On success the list is refetched, so the optimistic guess is replaced by
      // whatever the server actually has.
      invalidates: stable([["todos"]]),
    }),
  );

  @onElement("submit")
  submit(event: Event) {
    event.preventDefault();
    const title = this.draft.trim();
    if (!title) return;
    this.draft = "";
    // `mutate`, not `mutateAsync`: a click handler should not have to catch. The
    // failure is `this.add.error`.
    this.add.mutate(title);
  }

  renderTodo(title: string) {
    return <li>{title}</li>;
  }

  /** A bound method, not an inline arrow: RMD020 reports a handler built per render. */
  onDraftInput(event: Event) {
    this.draft = (event.target as HTMLInputElement).value;
  }

  render() {
    return (
      <div>
        {/*
          `list()`, not `.map()`. A map builds every vnode on every render and gives the
          diff nothing to match rows by; a list is lazy — the descriptor is built in
          render, the items by the diff, and an unchanged row's scope is reused. Its
          `render` is a bound method for the same reason.
        */}
        <ul>{list({ each: this.list.data ?? NONE, render: this.renderTodo })}</ul>

        <p className="demo-row">
          <input value={this.draft} placeholder="new todo" onInput={this.onDraftInput} />
          <button type="submit" disabled={this.add.isPending}>
            {this.add.isPending ? "saving…" : "add"}
          </button>
        </p>

        {this.add.isError ? (
          <p className="demo-note">
            rejected: {(this.add.error as Error).message} — the optimistic item was rolled back
          </p>
        ) : (
          <p className="demo-note">try adding "write the docs" twice to see the rollback</p>
        )}
      </div>
    );
  }
}
