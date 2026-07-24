---
title: Writing a hook
description: Give a hook input with options, and keep them reactive.
section: Hooks
order: 51
---

# Writing a hook

A hook can take input from whoever uses it — its **options** — read from
`this.options`:

```tsx
interface CounterOptions {
  start: number;
}

export class Counter extends Hook<CounterOptions> {
  @state count = 0;

  @create
  seed() {
    this.count = this.options.start;
  }

  increment() {
    this.count = this.count + 1;
  }
}
```

## Passing options

Two forms, and the difference matters:

```tsx
// A plain object — fixed for the life of the hook. For constants.
counter = this.use(Counter, { start: 10 });

// A callback — re-run whenever the owner re-renders. Use this whenever the
// options depend on something that changes.
counter = this.use(Counter, (self: Panel) => ({ start: self.props.initial }));
```

## Options are read-only

Like props, options belong to the caller — assigning to one throws (`RMD015`). It is
the same rule as [props](/concepts/props), because it is the same idea from the other
side. To change something an option gave you, copy it into your own `@state`, or take
a callback option and ask the owner.

## They stay reactive, per key

Each option key is its own signal. When the owner re-renders, the callback runs again
and only the keys whose values actually changed update. So a hook that reads
`this.options.start` reacts to `start` changing, not to some other key — exactly like
props. (An option the caller stops passing becomes `undefined`, so a removed key can't
linger.)

## Hooks compose

A hook can use other hooks; they all share the owner's re-rendering:

```tsx
export class Pagination extends Hook<PaginationOptions> {
  private route = this.use(RouteHook);
  // …
}
```

## Testing one

```ts
import { renderHook, act } from "@ramonda/testing-library";

const { current, rerender } = renderHook(Counter, { initialOptions: { start: 2 } });
expect(current.count).toBe(2);

act(() => current.increment());
expect(current.count).toBe(3);

rerender({ start: 99 }); // like a parent passing new options
```

`current` stays the same object between renders — a hook is built once and lives as
long as its owner; only its fields change.

## Next

- [Your own decorators](/hooks/own-decorators) — packaging a subscription.
