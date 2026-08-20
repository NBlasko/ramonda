---
title: Every decorator, at a glance
description: Which decorators run on the client, the server or both; which work on a component, a hook or both; and which may appear more than once.
section: Reference
order: 109
---

# Every decorator, at a glance

Three questions come up about every decorator, and none of them is guessable from the name:

- **Where does it run** — client, server, or both?
- **What can it go on** — a component, a hook, or both?
- **How many times** may it appear on one class?

## The table

| | Runs on | Goes on | More than once |
|---|---|---|---|
| [`@state`](/concepts/state) | both | component · hook | yes — one per field |
| [`@persist`](/ssr/env) | both | component · hook | yes — one per field |
| [`@compute`](/concepts/compute) | both | component · hook | yes |
| [`@memoized`](/reference/api) | both | component · hook | yes |
| [`@created`](/concepts/lifecycle) | both — `env` chooses | component · hook | yes, in order |
| [`@mounted`](/concepts/lifecycle) | both — `env` chooses | component · hook | yes, in order |
| [`@destroyed`](/concepts/lifecycle) | client in practice¹ | component · hook | yes, reverse order |
| [`@updated`](/concepts/lifecycle) | client in practice¹ | component · hook | yes |
| [`@watchProp`](/concepts/props) | client in practice¹ | component · hook | yes — one per selector |
| [`@deferHydration`](/ssr/async) | client (hydration only) | component · hook | yes — all are awaited |
| [`@catchError`](/composition/error-boundaries) | both | **component only** | **no** — a subclass may override |
| [`@ShouldUpdateOnPropsChange`](/concepts/props) | client in practice¹ | **component only** | **no** — a subclass may override |
| [`@StableProps`](/hooks/writing#when-a-value-in-the-bag-should-keep-its-identity) | client in practice¹ | **hook only** | **no** — it takes a list |
| [`@Host`](/concepts/host) | both | **component only** | **no** |
| [`@onElement`](/concepts/events) | **client only**² | **component only** | yes |
| [`@onWindow` / `@onDocument`](/concepts/events) | **client only**² | component · hook | yes |
| [`@interval` / `@timeout`](/concepts/timers) | **client only**² | component · hook | yes |
| [your own subscription](/hooks/own-decorators) | **client only**² | component · hook | yes |

¹ **"client in practice"** means the decorator is not gated to a side — it would run on the
server — but a server render gives it no occasion to. A server render commits once and never
unmounts, so there is no update for `@updated` or `@watchProp` to react to and no teardown for
`@destroyed`.

² **"client only"** is different, and stronger: these are built on effects, and effects never
attach during a server render. No `env` option changes that, and none of them has one.

## Where it runs, in more detail

`@created`, `@mounted` and `@destroyed` take `{ env: "client" | "server" | "shared" }`, and **`shared`
is the default** — so an undecorated `@mounted` runs on both sides. See
[client / server / shared](/ssr/env) for choosing.

One consequence catches people out: on **hydration** a `shared` `@created` is *skipped* — the
server already ran it and the state it wrote was restored from the page — while a `shared`
`@mounted` *runs again*, because the DOM it touches was rebuilt as the client adopted the markup.
That is why a [route guard](/routing/server#route-guards-and-redirects) belongs in `@mounted`.

A server render, measured end to end, runs exactly: `@created`, `@mounted`, and any `@compute`
something reads. Nothing else fires — not because it is forbidden, but for the reasons in the
footnotes above.

## What it goes on

**Almost everything works on a hook.** That is deliberate: a hook is where behaviour lives when
it needs no element of its own, and behaviour needs state, lifecycle, derived values and
listeners just as much as a component does.

Three do not, and each is **refused twice**: TypeScript rejects it at the decorator itself, and a
build with no types throws at construction, with a message saying what to do instead. Neither is
a lint you can talk past — the second exists because the first is not there in plain JavaScript.

| | why not |
|---|---|
| `@Host` | It names the element a component **is**. A hook adds no element — that is the point of a hook. |
| `@onElement` | It binds a listener to the component's host element. A hook has none. Use `@onWindow` / `@onDocument`, which work on both. |
| `@ShouldUpdateOnPropsChange` | It gates a **parent-driven** prop update. A hook's props come from its `this.use()` callback and refresh on every owner render — there is nothing to gate. |

One goes the other way. **`@StableProps` is hooks only**, and refused twice in the same way: a
hook's props are rebuilt by its own callback on every owner render, which is the situation it
answers. A component's props come from the parent's JSX and are compared by the diff, where
`@ShouldUpdateOnPropsChange` is the control.

## `render` takes none

Not one decorator goes on `render`, and each one is refused **in development**, where the class is
defined. Unlike the three refusals above — which hold in every build — this check lives with the
other decorator-argument checks, all of which are compiled out of production. The mistake is fixed
at the source, so the moment you write it is the only moment worth refusing it.

They are not all shades of wrong, and two of them are allowed now — `@compute` and `@memoized` cache the
render, which `RMD020` reports rather than refuses. Measured, one class per decorator:

| written on `render` | what it did |
|---|---|
| `@compute` | Cached the render on the signals it read. State and props still reach the DOM — so it looks fine — and anything it read that is NOT a signal freezes the page: measured, a plain field left `old` on screen where the same component without the decorator showed `new`. Silent, which is why the guard is not waiting for a crash. |
| `@memoized` | The same as `@compute` now: the render is cached, a state write still reaches the DOM (measured, `1` → `2`), and it freezes on anything the render read that is not a signal. It used to freeze on everything, before a memoised builder's reads invalidated their own entry. |
| `@created`, `@mounted`, `@updated`, `@destroyed` | Registered the render as a lifecycle callback, so it ran outside the render pass as well as inside it. |
| `@catchError` | Made the render the handler for errors thrown by its own subtree. |
| `@state`, `@persist` | Mean "serialise me", which a render is not. |

`render` is the one member Ramonda reserves. Put the behaviour on a member of its own and call it
from `render`:

```tsx
class Cart extends Component {
  @state items: { price: number }[] = [];

  @compute get total() {
    return this.items.reduce((sum, item) => sum + item.price, 0);
  }

  render() {
    return <p>{this.total}</p>;
  }
}
```

## How many times

Most decorators stack, and the order is defined:

- **`@created` and `@mounted`** run in declaration order; **`@destroyed`** runs in reverse, so cleanup
  undoes setup in the order it was done.
- **`@watchProp`** takes **several selectors** and may itself be repeated. One application with several
  selectors runs the method **once** when any of them changed, with the values as a tuple —
  `@watchProp((p) => p.page, (p) => p.term)`. Repeating the decorator instead gives each application its
  own entry, so two that moved in the same update call the method **twice**; prefer the several-selector
  form. A single selector still hands a tuple of one, which is why handlers destructure: `([next]: [T])`.
- **`@deferHydration`** may appear several times; hydration waits for all of them.
- **`@catchError`** is single: there is one answer to "who handles an error from below?". Two on one
  class are reported (RMD032), and **the lowest** is the one that runs — members initialise top to
  bottom, so it is applied last. A **subclass** declaring its own overrides the base's, which is not a
  duplicate and is not reported.
- **Listeners and timers** stack freely — that is the normal way to bind several events.

Three are single:

- **`@Host`** — a component is exactly one element, so there is one answer to which. Two on one class
  **throws**, in every build, because there is no correct program in which both are honoured. A
  **subclass** may declare its own, which overrides the base's — that is how a specialised component
  changes its element, and it is silent.
- **`@ShouldUpdateOnPropsChange`** — there is one answer to "take these props?". Two on ONE class are
  reported in development (RMD040), and **the highest** is the one that decides — class decorators apply
  bottom-up, so it is applied last. That is the opposite line from `@catchError` above, and the same
  rule: whichever is applied last is the one that stands. A **subclass** may declare its own, which
  overrides the base's — that is not a duplicate and is not reported.
- **`@StableProps`** — it takes as many names as you like, so a second one adds nothing you could not
  write in the first. Two on one class **merge** into the union and are reported as
  [RMD046](/reference/diagnostics#rmd046-more-than-one-stableprops-on-one-class): the result is what you
  asked for, spelled twice, so it is a warning rather than a refusal — unlike `@Host`, where two element
  names have no union. A **subclass** may declare its own, and that one *merges* with what the parent
  declared rather than replacing it, which is the intended way to extend the list.

## Two decorators that are not lifecycle

`@state` and `@persist` mark **fields**, not methods, so "runs on" means "is honoured on". Both
are honoured on both sides: `@state` is serialized into the page by a server render and restored
on hydration, and `@persist` is how a field that is not `@state` joins that payload.

## Next

- [The full API](/reference/api) — every export, grouped.
- [Lifecycle](/concepts/lifecycle) — what each phase is for.
- [client / server / shared](/ssr/env) — picking `env`.
