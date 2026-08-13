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
  // initializers run, so there is no placeholder to seed and copy over in `@created`.
  @state count = this.props.start;

  increment() {
    this.count = this.count + 1;
  }
}
```

## Passing props

Two forms, and the difference matters:

```tsx alternatives
// A plain object — fixed for the life of the hook. For constants.
counter = this.use(Counter, { start: 10 });

// A callback — re-run whenever a signal it reads moves. Use this whenever a prop
// depends on something that changes.
counter = this.use(Counter, (self: Panel) => ({ start: self.props.initial }));
```

The callback receives the owner (`self`), so a hook's props can be built from the
owner's own props or state — that is what keeps them in sync.

**The parameter is typed for you.** `self` is the class the `use()` is written in, so
`self.load` is checked and a name that is not there is a compile error that says which:

```
Property 'load' does not exist on type 'Panel'.
```

Annotating it — `(self: Panel)` — still works and is worth doing when a callback is written
once and shared: the annotation is then checked against every class that uses it, so a
shared callback handed to a class it does not fit is refused rather than failing at runtime.

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

Each prop is its own signal. When the callback runs again, only the keys whose values actually
changed update. So a hook that reads
`this.props.start` reacts to `start` changing, not to some other key — exactly like a
component. (A prop the caller stops passing becomes `undefined`, so a removed key
can't linger.)

## Hooks compose

A hook can use other hooks; they all share the owner's re-rendering:

```tsx
const { Navigator } = createRouter(routes);

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

**The callback is cached on the signals it reads** — the same contract `@compute` gives a
getter. On a render where none of them moved it is not called, and the bag it returned last
time is handed over unchanged, down to the arrays and closures inside it. So the ordinary way
of writing one is also the cheap way, and there is nothing to wrap:

```tsx
private list = this.use(Filtered, (self: Panel) => ({
  filter: { q: self.query },          // one object until `query` moves
  onPick: (id: string) => self.pick(id),   // one closure, likewise
}));
```

This scales the way you would want it to. A component with ten hooks, where one signal moves:
**one callback runs and one hook recomputes**, not ten of each. The nine whose callbacks read
nothing that moved are not asked for a bag at all.

`render()` is a separate matter — it runs on every rebuild. The cache is about the props
callback, not about rendering.

**What the cache does not do is make a rebuilt value equal to the last one.** On the renders
where the callback *does* run — because something it reads moved — every array and closure in
it is fresh, and **every prop is a signal** that compares by reference. So a `@compute` reading
a rebuilt array recomputes, a `@watchProp` on it fires, and a subscription whose `connect`
reads it reconnects, for the one key that changed and the ones that did not.

That is the case the rest of this section is about. Development builds report it as
[RMD022](/reference/diagnostics), which names a value only once it has been rebuilt several
times running *without ever changing*. A key that genuinely differs each time is not churn, and
is not reported.

The other half of the bargain: a value that reaches the bag *without* passing through a signal
is invisible to the cache, so the bag keeps the version it last built.
[RMD027](/reference/diagnostics) reports that; the fix is to make the value reactive.

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
the parent's JSX, where [`@ShouldUpdateOnPropsChange`](/concepts/props) is the control.

Now the framework keeps one identity for those props for as long as their contents are
equal (nested objects included), and the call site writes the plain literal:

```tsx
private user = this.use(Query, (self: UserCard) => ({
  key: ["user", self.props.id],   // one array until `id` moves — nothing to wrap
  fetch: self.load,
}));
```

**If you are USING a hook that declared nothing: hold the value yourself.** Give it an identity
somewhere — a `@compute`, a field, a module constant — and hand that over, so the callback passes
along a value instead of building one:

```tsx
@compute get series(): readonly number[] {
  return [this.props.a, this.props.b];
}

private chart = this.use(SomeChart, (self: Panel) => ({ series: self.series }));
```

A `@compute` is invalidated by the signals it **read**, so this holds one array for as long as
`a` and `b` do not move. Note what that is *not*: it follows the dependencies, not the contents.
A compute whose answer is coarser than its inputs — `this.noise > 5`, `items.length` — produces a
fresh value whenever those inputs move, even though the answer did not, and splitting it into two
computes does not help because invalidation propagates rather than being deduplicated by value.
[RMD024](/reference/diagnostics) is the report for that.

**Absorbing that belongs to the hook, not to the call site.** `Query.onKeyChanged` is the worked
example: it compares the key part by part before doing anything, *even though the framework
already did*. A hook written that way is immune; a hook that is not has a problem the call site
can only paper over. See [what you cannot assume](#what-you-cannot-assume-about-your-props).

**Know the bound before you declare a payload.** `@StableProps` compares to a bounded depth —
**five levels** — and calls anything **wider than fifty items** different rather than sampling it.
Both bounds err the same way: past them you get a fresh identity, which is correct and merely not
optimal. So declaring a large or deep prop stable quietly stops helping rather than quietly going
wrong.

For a prop that carries a payload rather than a key, do the comparison yourself and do it in full:
`@ramonda/form` does not declare `defaultValues` for that reason.

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

**When you will be called.** The props callback runs when a signal *it* reads has moved. One
callback can read six signals and hand you a single prop, so a run tells you something in the
owner moved — not that your prop did. Being called is not news.

**Whether a value is the same object as last time.** A declaration covers the props you
thought of, to a bounded depth and width; everything else arrives fresh whenever the caller's
callback rebuilds it, or whenever whatever they derived it from was invalidated. So a `@watchProp` handler has to be **cheap and idempotent** — it will run for a
reference that changed and a value that did not. `Query` does exactly this: the framework
already compares the key, and `onKeyChanged` still compares the parts itself, then the hash,
before it will start a request. A handler that fetches, resets a form or scrolls without that
guard does it every time somebody else's callback is invalidated, which is not yours to predict.

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
