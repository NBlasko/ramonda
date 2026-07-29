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
import { Mutation, mutationOptions } from "@ramonda/query";

// The host IS the form. `@onElement` listens on the component's host element, so a
// `submit` handler needs the host to be the thing that emits `submit` — see
// [the host element](/concepts/host).
@Host("form")
class AddTodo extends Component {
  @state draft = "";

  private add = this.use(Mutation, () =>
    mutationOptions({
      mutate: (title: string) => api.createTodo(title),
      invalidates: [["todos"]],
    }),
  );

  @onElement("submit")
  submit(event: Event) {
    event.preventDefault();
    this.add.mutate(this.draft);
    this.draft = "";
  }

  render() {
    return (
      <div>
        <input value={this.draft} onInput={this.typed} />
        <button type="submit" disabled={this.add.isPending}>
          {this.add.isPending ? "saving…" : "add"}
        </button>
      </div>
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
private add = this.use(Mutation, () =>
  mutationOptions({
    mutate: (title: string) => api.createTodo(title),
    onMutate: (title, { client }) => {
      const previous = client.peek<Todo[]>(["todos"])?.data;
      client.setData<Todo[]>(["todos"], (todos) => [...(todos ?? []), draft(title)]);
      return () => client.setData(["todos"], previous);   // ← the rollback
    },
    invalidates: [["todos"]],
  }),
);
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

## The callbacks

| | When |
|---|---|
| `onMutate(vars, ctx)` | Before the request. Return a function to make it the rollback |
| `onSuccess(data, vars, ctx)` | After success, after `invalidates` has run |
| `onError(error, vars, ctx)` | After failure, after the rollback |
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
