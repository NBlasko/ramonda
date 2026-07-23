---
title: Writing a hook
description: Options as a bag or a callback, why they are read-only, and how they stay reactive.
section: Hooks
order: 51
---

# Writing a hook

A hook takes an options type and reads it from `this.options`.

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

Two forms, and the difference matters.

```tsx
// A plain bag — fixed for the life of the hook.
counter = this.use(Counter, { start: 10 });

// A callback — re-evaluated when the owner re-renders.
counter = this.use(Counter, (self: Panel) => ({ start: self.props.initial }));
```

**Reach for the callback whenever the options depend on anything that changes.** The bag form is
for constants.

## Options are read-only, and they throw

```tsx
this.options.start = 5;   // TypeError, RMD015
```

They belong to the caller. Assigning throws in every build — the same rule and the same reasoning
as [props](/concepts/props), because they are the same thing seen from the other side: one rule
for read-only inputs, not two.

Copy into your own `@state`, or take a callback option and ask the owner to change it.

## How they stay reactive

Each option key is backed by its own signal on the owner's runtime. When the owner re-renders,
the callback is re-evaluated and only the keys whose values actually moved are updated.

So a hook that reads `this.options.start` reacts to `start` changing and not to some other key
changing on the same bag. Reads are per key, exactly like props.

An option a caller stops passing is set to `undefined` rather than keeping its last value — a
removed key would otherwise be invisible forever.

## Hooks compose

A hook may use hooks:

```tsx
export class Pagination extends Hook<PaginationOptions> {
  private route = this.use(RouteHook);
  ...
}
```

They share the owner's runtime all the way down, so the whole chain re-renders the same component.

## Testing one

```ts
import { renderHook, act } from "@ramonda/testing-library";

const { current, rerender } = renderHook(Counter, { initialOptions: { start: 2 } });
expect(current.count).toBe(2);

act(() => current.increment());
expect(current.count).toBe(3);

rerender({ start: 99 });   // drives the same option signals a parent would
```

`current` does **not** change between renders — a hook is constructed once by `use()` and lives
as long as its owner. The instance is the identity; the fields are what change.

## Next

- [Your own decorators](/hooks/own-decorators) — packaging a subscription.
