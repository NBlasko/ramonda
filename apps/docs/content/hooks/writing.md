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

## Next

- [Your own decorators](/hooks/own-decorators) — packaging a subscription.
