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

**If you use that parameter, annotate it** — `(self: Panel)` — as above. It is what
gives the owner its type; leaving the annotation off is an error rather than a silent
`any`, the same stance [`@watchProp`](/concepts/props) takes for its selector. (A *class*
decorator like [`@Host`](/concepts/host) needs no annotation, because there the decorated
class supplies the type. Here there is no class to read it from — the callback is an
argument to a method call.)

**Or just write `this`,** which is equally correct: the callback is an arrow function in a
field initializer, so `this` is the instance both at runtime and to the type-checker —
including for a *generic* hook inferring its type parameter from what the callback
returns.

```tsx
counter = this.use(Counter, () => ({ start: this.props.initial }));
```

The parameter earns its keep in two cases. One, if the callback is ever written as a
`function` rather than an arrow, where `this` would be `undefined`. Two, if it moves out of
the class — a shared helper or a module-level function has no `this` to read.

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

## When a value in the bag should keep its identity

The callback runs on every render of the owner, so the bag it returns is a new object
each time — and so is every array and closure inside it. **Every prop is a signal**, and a
signal compares by reference, so a rebuilt array is a *changed* prop: a `@compute` reading
it recomputes, a `@watchProp` on it fires, and a subscription whose `connect` reads it
reconnects. Every render. Measured in core's tests, across three renders of the owner: a
compute reading a rebuilt array runs three times where one reading a scalar prop runs
once.

Development builds report it as [RMD022](/reference/diagnostics) — the callback is called
twice in the same tick and the two bags compared, the same check `render()` gets.

**If you are WRITING the hook: declare which props are values.** A query key is a value —
`["user", 7]` built again is the same question — and that is the hook's knowledge, not
something every call site should have to encode:

```tsx
@StableProps("key")
export class Query extends Hook<QueryProps> {}
```

A class decorator, like [`@Host`](/concepts/host), because the declaration is about the
hook rather than about any one member — props are not members at all, they live behind the
`this.props` proxy. A subclass that declares more **adds** to what its parent declared
rather than replacing it, so nothing can be dropped by forgetting to carry it over.

**The names are checked against your props**, with no type argument to write:
`@StableProps("kye")` is a compile error that names `"kye"`, and an optional prop counts as
a prop. Putting it on a component is a compile error too — a component's props come from
the parent's JSX, where [`@shouldUpdateOnPropsChange`](/concepts/props) is the control.

Now the framework keeps one identity for those props for as long as their contents are
equal (nested objects included), and the call site writes the plain literal:

```tsx
private user = this.use(Query, (self: UserCard) => ({
  key: ["user", self.props.id],   // one array until `id` moves — nothing to wrap
  fetch: self.load,
}));
```

**If you are USING a hook that declared nothing: `stable()`.** The same thing from the
outside, per value — the counterpart of [`list()`](/lists) for a props bag:

```tsx
import { stable } from "@ramonda/core";

private chart = this.use(SomeChart, (self: Panel) => ({
  series: stable([self.props.a, self.props.b]),
}));
```

**A function: a bound method.** Two closures with the same body are not equal by any
comparison that is safe to make, so neither `stable()` nor `@StableProps` can help — a hook
that lists a function prop still gets the report, because unstable *and* silent would be
the worst of both. A method
reads `this` when it is *called*, so there is nothing to capture — and methods are bound,
so the identity never changes:

```tsx
load(ctx: FetchContext) {
  return api.getUser(this.props.id, ctx);   // read at call time
}
```

[`@memoizedHandler`](/concepts/events) covers the case where the function has to be built
per argument; it caches by its arguments, so it is stable too.

**Or a `@compute` for the whole bag**, which fixes every value in it at once:

```tsx
@compute get userQuery() {
  return { key: ["user", this.props.id], fetch: (ctx) => api.getUser(this.props.id, ctx) };
}

private user = this.use(Query, (self: UserCard) => self.userQuery);
```

A compute recomputes only when something it **read** changes, so on an unrelated render
the bag, the key array and the closure are all the same objects as last time.

**The rule for a compute is one sentence: read what you need.** If it is reactive, the
compute refreshes itself when it moves. If it is *not* reactive — `Date.now()`, a module
variable, the DOM — the compute freezes it at the moment it was first asked for and
nothing ever refreshes it. Development builds report randomness read inside a compute for
exactly that reason ([RMD021](/reference/diagnostics)).

## What you cannot assume about your props

The framework reports the mistakes it can see, and those reports are development-only. A
hook — a **reusable** one especially — is written against what it might actually be handed,
not against what a well-behaved caller would send. Four things you do not know:

**When you will be called.** The props callback runs on every render of the owner, and the
owner re-renders for reasons that have nothing to do with you. Being called is not news.

**Whether a value is the same object as last time.** A declaration or `stable()` covers the
props you thought of; everything else arrives fresh whenever the caller's callback rebuilds
it. So a `@watchProp` handler has to be **cheap and idempotent** — it will run for a
reference that changed and a value that did not. `Query` does exactly this: the framework
already compares the key, and `onKeyChanged` still compares the parts itself, then the hash,
before it will start a request. A handler that fetches, resets a form or scrolls without
that guard does it on every render of somebody else's component.

**What the value is.** A prop the caller stopped passing becomes `undefined` — a key that
was there is gone, an array is nullish, a callback prop is missing. And a value can be
anything the caller's types allowed, which for a generic hook is a lot: `Query` hashes its
key, so it validates that the key is JSON-serializable and reports `RMQ001` when it is not,
because a function in a key is silently dropped by `JSON.stringify` and two different
queries would collide on one cache entry. Where the shape of a prop decides what your hook
*does*, check it and say so.

**Whether the app is in a development build.** RMD022 needs the strict render, the
diagnostics are stripped from production, and none of them run for a caller who turned them
off. A check is how a mistake gets *found*; it is not what makes your hook safe.

The rule that follows: **compare by value what is a value, and be idempotent about the
rest.** That is the whole of it — and it is why `@StableProps` exists, so a hook can
state the first half once rather than hoping every caller does.

## Next

- [Your own decorators](/hooks/own-decorators) — packaging a subscription.
