---
title: Your own decorators
description: Make a decorator that subscribes on mount and cleans up on unmount.
section: Hooks
order: 62
---

# Your own decorators

`@interval`, `@timeout`, `@onWindow` and `@onDocument` all share one shape: subscribe
to something when the component appears, unsubscribe when it goes away.
`createSubscriptionDecorator` lets you make your own decorator with that shape —
handy for connecting to an external store or any subscribe/unsubscribe API.

```tsx
import { createSubscriptionDecorator } from "@ramonda/core";

export const onStore = createSubscriptionDecorator(
  "onStore",
  (_owner, handler: (state: ThemeState) => void, store: ThemeStore) => store.subscribe(handler),
);
```

`handler` and the decorator's own arguments (`store`) are annotated because they are the
**contract**: `handler`'s signature is what the decorated method is checked against, and
those annotations are the only place that shape is written down.

`owner` is different — it is optional, and annotating it is how a decorator demands
something of the class it goes on:

```tsx
export const onRowStore = createSubscriptionDecorator(
  "onRowStore",
  (owner: Component<{ id: string }>, handler: (state: ThemeState) => void, store: ThemeStore) =>
    store.subscribe(handler, owner.props.id),   // reads the real instance
);
```

Put that on a component without an `id` prop and it does not compile, with a message naming
the owner type it wanted. Leave `owner` unannotated and the decorator works on any component
or hook, which is what the built-in ones do.

Then use it like the built-in ones:

```tsx
export class Panel extends Component {
  @state theme = "light";

  @onStore(themeStore)
  themeChanged(next: ThemeState) {
    this.theme = next.theme;
  }
}
```

**The method's parameter needs its annotation** (`next: ThemeState`), even though `connect`
already declared the handler's shape. A decorator cannot contextually type the signature it
decorates — an unannotated parameter is an implicit `any` (TS7006) — which is a TypeScript
limitation rather than a choice, and the same one [`@watchProp`](/concepts/props) lives with.

```demo:StoreSubscription
```

You write the connect — subscribe, and return the unsubscribe — and Ramonda handles
the teardown. Nothing in `Panel` has to remember the subscription exists.

## What `createSubscriptionDecorator` is for

Connecting to anything with a subscribe/unsubscribe pair: an external state store, a
plain event emitter, a `WebSocket`, an `IntersectionObserver`.

## The rule: return a function, or nothing

The connect must return the cleanup **function** — not an object.

```tsx
// ✓  store.subscribe returns an unsubscribe function
(owner, handler, store) => store.subscribe(handler);
```

Many APIs hand back `{ unsubscribe }` instead, which is not a function — wrap it:

```tsx
const sub = store.subscribe(handler);
return () => sub.unsubscribe();
```

Returning the object would silently leak the subscription past unmount, so development
throws and names the fix.

## `connect` can follow a value

It runs inside an effect, so if it reads `owner.props.x` or a `@state` field, the
subscription follows that value — disconnecting the old target before connecting the
new. Read nothing, and it subscribes exactly once.

## It works on hooks too

The requirement is a runtime, not an element, so a [hook](/hooks) can own a
subscription just like a component can.

## Next

- [Rendering lists](/lists) — `list()`, and why it takes the key away.
