---
title: Mutations
description: Writing — with the pending state, the failure, and a rollback that is just the function you return.
section: Async data
order: 95
---

# Mutations

A query is a question; a mutation is an act. That difference is why its state is not
in the cache: two components asking `["user", 7]` share one answer, and that sharing
is the point — but two components each with an "add todo" button are performing two
different acts, and neither should show the other's spinner or the other's error.

```tsx
import { Mutation } from "@ramonda/query";

interface Todo {
  id: string;
  title: string;
}

// The `<form>` is written in the render, with the `submit` handler on it: a listener belongs
// on the element that emits the event.
class AddTodo extends Component {
  @state draft = "";

  private add = this.use(Mutation<Todo, string>, () => ({
    mutate: (title) => api.createTodo(title),
    invalidates: [["todos"]],
  }));

  submit(event: Event) {
    event.preventDefault();
    this.add.mutate(this.draft);
    this.draft = "";
  }

  // A method, not an inline arrow: methods are auto-bound, so the identity never changes
  // and the listener is not removed and re-added on every render.
  typed(event: Event) {
    this.draft = (event.target as HTMLInputElement).value;
  }

  render() {
    return (
      <form onsubmit={this.submit}>
        <input value={this.draft} oninput={this.typed} />
        <button type="submit" disabled={this.add.isPending}>
          {this.add.isPending ? "saving…" : "add"}
        </button>
      </form>
    );
  }
}
```

`invalidates` is the common case written declaratively: once the mutation succeeds,
those keys are marked stale and whoever is watching them refetches. Declaring it beats
remembering it in one of several `onSuccess` branches.

## `mutate` or `mutateAsync`

`mutate` **never rejects.** The failure is `this.add.error`, so a click handler does
not have to catch — an unhandled rejection there is a console error the user cannot
act on, and a mutation that failed is a state to render.

`mutateAsync` returns a promise that resolves with the data and rejects on failure,
for a caller that needs to know:

```ts
try {
  const todo = await this.add.mutateAsync(title);
  this.route.push(`/todos/${todo.id}`);
} catch {
  // already recorded as this.add.error
}
```

## Optimistic updates

Put the change on screen before the request answers, and undo it if the request
fails. The undo is **the function `onMutate` returns** — the same "return the cleanup"
contract [a subscription](/concepts/subscriptions) and
[`createSubscriptionDecorator`](/hooks/own-decorators) use, so it is one idea to
learn rather than three:

```tsx
private add = this.use(Mutation<Todo, string>, () => ({
  mutate: (title) => api.createTodo(title),
  onMutate: (title, { client }) => {
    const previous = client.peek<Todo[]>(["todos"])?.data;
    // A stand-in for what the server will send back. The id is temporary — the refetch that
    // `invalidates` triggers replaces this whole item with the real one.
    const optimistic: Todo = { id: `pending:${title}`, title };

    client.setData<Todo[]>(["todos"], (todos) => [...(todos ?? []), optimistic]);
    return () => client.setData(["todos"], previous);   // ← the rollback
  },
  invalidates: [["todos"]],
}));
```

```demo:MutationDemo
```

Add something new and it appears instantly, then the list refetches and the server's
version replaces the guess. Add `"write the docs"` a second time and the server
rejects it — the optimistic item disappears again.

Two details make that safe:

- **`setData` abandons a fetch already in flight.** An explicit write is newer
  information than a request made before it, so without this an optimistic update
  could be undone moments later by a response that was already on its way —
  intermittently, depending on which won.
- **The rollback runs even if the component unmounted first.** It undoes a write to
  the cache, which outlives the hook; leaving an optimistic value in there because
  the button went away is how a list ends up showing a todo the server refused.

### Editing one item rather than appending

Appending is a spread. Changing something *inside* a cached value is where writing it by hand gets
long — every level above the change has to be copied:

```tsx
client.setData<Todo[]>(["todos"], (todos) =>
  (todos ?? []).map((todo) => (todo.id === id ? { ...todo, title } : todo)),
);
```

[`@ramonda/lens`](/lens) says the same thing as a path:

```tsx
import { focusOn } from "@ramonda/lens";

client.setData<Todo[]>(["todos"], (todos) =>
  focusOn(todos ?? [])
    .where((todo) => todo.id === id)
    .get("title")
    .set(title),
);
```

Both produce a new array and leave the untouched items as the same objects, which is what keeps
`list()` from rebuilding rows that did not change. The lens earns its place as the change goes
deeper — two levels in, the hand-written version is three spreads and a `map`.

## The callbacks

| | When |
|---|---|
| `onMutate(vars, ctx)` | Before the request. Return a function to make it the rollback |
| `onSuccess(data, vars, ctx)` | After success, after `invalidates` has run |
| `onerror(error, vars, ctx)` | After failure, after the rollback |
| `onSettled(vars, ctx)` | After either — for the spinner nobody wants to leave up |

Each receives `ctx.client`, so a handler can invalidate, write or read the cache
without the component reaching for the provider itself.

## The state

`isIdle`, `isPending`, `isSuccess`, `isError`, plus `data` and `error`. Two successes
in a row both re-render, which is less obvious than it sounds: `status` would be
written `"success"` over `"success"`, the signal would compare equal, and the second
result would never reach the screen — so a counter moves with it.

`reset()` puts the hook back to idle, for a form that has shown its error and is being
tried again: without it, `isError` keeps a stale message under a field the user has
since fixed.

## Cancelling

`cancel()` aborts the request if the transport honours the signal. It is **not**
called on unmount, and that is deliberate: a write that has left is not something to
cancel because the button that started it went away — the server may well have applied
it, and cancelling only loses the confirmation. What unmounting stops is the state
writing back into a hook that is gone.

## Next

- [On the server](/query/server) — what crosses the boundary.
