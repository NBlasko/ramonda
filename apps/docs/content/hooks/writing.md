---
title: Writing a hook
description: Give a hook props, read them from this.props, and keep them reactive.
section: Hooks
order: 61
---

# Writing a hook

A hook takes input from whoever uses it — its **props** — read from `this.props`,
exactly like a component. Same word, same idea: they are read-only and owned by the
caller.

```tsx
interface CounterProps {
  start: number;
}

export class Counter extends Hook<CounterProps> {
  // Read a prop straight into state — `this.props` is ready before the field
  // initializers run, so there is no placeholder to seed and copy over in `@create`.
  @state count = this.props.start;

  increment() {
    this.count = this.count + 1;
  }
}
```

## Passing props

Two forms, and the difference matters:

```tsx
// A plain object — fixed for the life of the hook. For constants.
counter = this.use(Counter, { start: 10 });

// A callback — re-run whenever the owner re-renders. Use this whenever a prop
// depends on something that changes.
counter = this.use(Counter, (self: Panel) => ({ start: self.props.initial }));
```

The callback receives the owner (`self`), so a hook's props can be built from the
owner's own props or state — that is what keeps them in sync.

**Annotate that parameter** — `(self: Panel)` — as above. It is what gives the owner
its type; leaving it off is an error rather than a silent `any`, the same stance
[`@watchProp`](/concepts/props) takes for its selector. (Annotating it is also what
lets a *generic* hook infer its type parameter from what the callback returns.)

## Props are read-only

A hook's props belong to the caller, exactly like a component's — assigning to one
throws (`RMD015`). It is the same rule as [component props](/concepts/props), because
it is the same idea from the other side. To change something a prop gave you, copy it
into your own `@state`, or take a **callback prop** and ask the owner to change it.

## They stay reactive, per key

Each prop is its own signal. When the owner re-renders, the callback runs again and
only the keys whose values actually changed update. So a hook that reads
`this.props.start` reacts to `start` changing, not to some other key — exactly like a
component. (A prop the caller stops passing becomes `undefined`, so a removed key
can't linger.)

## Hooks compose

A hook can use other hooks; they all share the owner's re-rendering:

```tsx
export class Pagination extends Hook<PaginationProps> {
  private route = this.use(Navigator);
  // …
}
```

## Testing one

```ts
import { renderHook, act } from "@ramonda/testing-library";

const { current, rerender } = renderHook(Counter, { initialProps: { start: 2 } });
expect(current.count).toBe(2);

act(() => current.increment());
expect(current.count).toBe(3);

rerender({ start: 99 }); // like a parent passing new props
```

`current` stays the same object between renders — a hook is built once and lives as
long as its owner; only its fields change.

## When the bag should stay the same object

The callback runs on every render of the owner, so the bag it returns is a new object
each time, with new arrays and new closures inside it. That is almost always fine — the
values are equal, and the framework compares each prop and wakes only the signals whose
value actually moved.

It stops being fine when something **reactive** reads the bag. A `@compute` that reads a
rebuilt array recomputes every render, so its cache does nothing; a subscription whose
`connect` reads one disconnects and reconnects every render. Two ways to fix that, both
using what you already have.

**A method instead of a closure.** It reads `this` when it is called, so there is
nothing to capture — and methods are bound, so the identity never changes:

```tsx
load(ctx: FetchContext) {
  return api.getUser(this.props.id, ctx);   // read at call time
}

private user = this.use(Query, (self: UserCard) => ({
  key: ["user", self.props.id],
  fetch: self.load,                          // the same function every render
}));
```

**A [`@compute`](/concepts/compute) for the whole bag**, which fixes the arrays and the
closures in one move:

```tsx
@compute get userQuery() {
  return { key: ["user", this.props.id], fetch: (ctx) => api.getUser(this.props.id, ctx) };
}

private user = this.use(Query, (self: UserCard) => self.userQuery);
```

A compute recomputes only when something it **read** changes, so on an unrelated render
the bag, the key array and the closure are all the same objects as last time. Measured
in core's own tests: three renders, one bag.

**The rule for a compute is one sentence: read what you need.** If it is reactive, the
compute refreshes itself when it moves. If it is *not* reactive — `Date.now()`, a module
variable, the DOM — the compute freezes it at the moment it was first asked for and
nothing ever refreshes it. Development builds report randomness read inside a compute
for exactly that reason ([RMD021](/reference/diagnostics)).

## Next

- [Your own decorators](/hooks/own-decorators) — packaging a subscription.
