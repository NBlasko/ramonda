---
title: Your own decorators
description: createSubscriptionDecorator turns "subscribe, and unsubscribe on unmount" into a decorator.
section: Hooks
order: 52
---

# Your own decorators

`@interval`, `@timeout`, `@onWindow` and `@onElement` are all the same shape: subscribe to
something when the component mounts, unsubscribe when it goes away. `createSubscriptionDecorator`
is that shape, exposed.

```tsx
import { createSubscriptionDecorator } from "@ramonda/core";

export const onStore = createSubscriptionDecorator(
  "onStore",
  (_owner, handler: (state: ThemeState) => void, store: ThemeStore) =>
    store.subscribe(handler),
);
```

Then:

```tsx
export class Panel extends Component {
  @state theme = "light";

  @onStore(themeStore)
  themeChanged(next: ThemeState) {
    this.theme = next.theme;
  }
}
```

```demo:StoreSubscription
```

Write the `connect` — subscribe, return the unsubscribe — and the framework owns the teardown.
There is nothing in `Panel` that remembers the subscription exists.

## Connecting to an external store

This is what it is for. Zustand, Redux, a plain event emitter, a WebSocket, `IntersectionObserver`
— anything with a subscribe/unsubscribe pair.

## The rule: return a function, or nothing

```tsx
// ✓
(owner, handler, store) => store.subscribe(handler)

// ✗ — an object is not a cleanup
(owner, handler, store) => store.subscribe(handler)   // returns { unsubscribe }
```

`{ unsubscribe }` is a common return shape, and it is **not** a function. Without a check it
would be silently dropped and the subscription would outlive the component — measured: 1 listener
after mount, still 1 after unmount, page still working, nothing said a word.

Development throws on it and names the fix:

```tsx
const sub = store.subscribe(handler);
return () => sub.unsubscribe();
```

## The handler's type comes from `connect`

The decorated method's signature is taken from `connect`'s `handler` parameter, so a method with
the wrong shape is a type error at the call site rather than a surprise at runtime.

## `connect` may read signals

It runs inside an effect, so reading `owner.props.x` or a `@state` field makes the subscription
**follow** that value — disconnecting the old target before connecting the new one. Read nothing
and it subscribes exactly once.

## Validating your decorator's arguments

The optional third parameter runs at **class-definition time** — the cheapest moment to catch a
wrong argument, since a decorator's arguments are fixed at the source and can never depend on
runtime data.

```tsx
export const onChannel = createSubscriptionDecorator(
  "onChannel",
  (_owner, handler: (msg: string) => void, name: string) => subscribe(name, handler),
  (name) => {
    if (!name) throw new Error("[@onChannel] needs a channel name");
  },
);
```

That is how `@interval` rejects a non-numeric delay where it is written, rather than on the first
commit.

## It works on hooks too

The constraint is a runtime, not an element — so a [hook](/hooks) can own a subscription just as
a component can.

## Next

- [Rendering lists](/lists) — `list()`, and why it takes the key away.
