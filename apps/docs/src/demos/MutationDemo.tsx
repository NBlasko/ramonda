import { Component, Host, onElement, state } from "@ramonda/core";
import { Mutation, Query, QueryClientProvider, mutationOptions, queryOptions } from "@ramonda/query";

// The "server": a list, and a rule that rejects anything already there. The
// rejection is what makes the rollback visible.
let todos = ["write the docs"];

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

@Host("div")
export class MutationDemo extends Component {
  private query = this.use(QueryClientProvider);

  @state draft = "";

  private list = this.use(Query, () =>
    queryOptions({
      key: ["todos"],
      fetch: () => loadTodos(),
      staleTime: 10_000,
    }),
  );

  private add = this.use(Mutation, () =>
    mutationOptions({
      mutate: (title: string) => createTodo(title),
      // Optimistic: the item is on screen before the request answers. What this
      // returns is the ROLLBACK — the same "return the cleanup" contract
      // `@effect` and `createSubscriptionDecorator` use — and it runs only if
      // the mutation fails.
      onMutate: (title, { client }) => {
        const previous = client.peek<string[]>(["todos"])?.data;
        client.setData<string[]>(["todos"], (list) => [...(list ?? []), title]);
        return () => client.setData<string[]>(["todos"], previous ?? []);
      },
      // On success the list is refetched, so the optimistic guess is replaced by
      // whatever the server actually has.
      invalidates: [["todos"]],
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

  render() {
    return (
      <form>
        <ul>
          {(this.list.data ?? []).map((title) => (
            <li>{title}</li>
          ))}
        </ul>

        <p className="demo-row">
          <input
            value={this.draft}
            placeholder="new todo"
            onInput={(event: Event) => {
              this.draft = (event.target as HTMLInputElement).value;
            }}
          />
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
      </form>
    );
  }
}
