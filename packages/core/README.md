# @ramonda/core

A UI framework. **Explicit. Predictable. Readable.**

[![npm](https://img.shields.io/npm/v/%40ramonda%2Fcore)](https://www.npmjs.com/package/@ramonda/core)
[![license](https://img.shields.io/npm/l/%40ramonda%2Fcore)](https://github.com/NBlasko/ramonda/blob/main/LICENSE)

One rule carries most of the design:

> **Every JSX tag is exactly one element.**

The DOM is readable straight off the JSX. There are no fragments, no wrapper
components that vanish at runtime, and no function components — because a
function has no element, so as a tag it would be a lie.

```tsx
import { Component, Host, state } from "@ramonda/core";

@Host("button")
class Counter extends Component {
  @state clicks = 0;

  bump() {
    this.clicks++;
  }

  render() {
    return <span onClick={this.bump}>clicked {this.clicks} times</span>;
  }
}
```

## Before anything else: your bundler must transform decorators

**TC39 decorators are not yet parseable by any JavaScript engine.** `@Host("div")
class …` is a syntax error in Node and in every browser. If your toolchain
leaves them in the output, the bundle does not fail to work — it fails to
*parse*, and the page is blank with `Uncaught SyntaxError: Invalid or unexpected
token`.

Measured across the pipelines this repo has used:

| pipeline | decorators |
| --- | --- |
| esbuild directly | stripped ✅ |
| core's own `tsup` build | stripped ✅ |
| Vite 7 (esbuild) client build, **with** `jsxInject` | stripped ✅ |
| Vite 7 client build, without `jsxInject` | **survive** ❌ |
| Vite 7 `--ssr` build | **survive** ❌ |
| Vite 8 (oxc), any mode | **survive** ❌ |

The Vite 7 row that works does so *by accident*: `jsxInject` adds an import to
every module, which forces each one through the esbuild transform, and that
transform is what removes the decorators. Take `jsxInject` away for an unrelated
reason and they come back.

**So: build with esbuild, and check the output.** A bundle no engine can parse is
trivially detectable — parse each emitted chunk after building. See
`apps/playground-ssr` for a setup that does not rely on the accident.

## The pieces

### Components

A class with a `render()`. `@Host(tag)` chooses the element it becomes; without
it the component gets `<ramonda-host>`, an inert custom element styled
`display: contents` so it takes part in no layout. That is what makes wrapping
something in a component free.

`@Host` takes a second argument for reactive host attributes:

```tsx
@Host("div", (self: Card) => ({ className: self.open ? "open" : "" }))
class Card extends Component { … }
```

The tag may be a callback instead of a string, so the caller picks the element:

```tsx
@Host((p: CardProps) => p.as ?? "div")
class Card extends Component<CardProps> { … }

<Card as="section" />
```

It receives the props and must be **pure** — the diff calls it while deciding
whether an existing element can be reused, so it runs more than once.

One instance's host never changes: the tag is resolved when the component is
built and kept for its lifetime, because the host element *is* the component and
swapping it would destroy its state, its listeners and anything a ref points at.
A prop that resolves to a different tag does not retag the element — it fails to
match in the diff, and a fresh component is built. No `key` needed; the framework
decides, so there is nothing to remember and nothing to get silently wrong.

### Lifecycle

`@create` runs while the component is being built — before its element exists.
`@mount` runs after the DOM is committed, so by then the element **is** in the
document: measure it, focus it, hand it to a library. `@destroy` runs on teardown.

Within one commit the order is: every child's `@mount` before its parent's, and
per component `@mount` before its effects — so listeners registered by
`@onElement` are live by the time `@mount` runs.

A component torn down before the commit finishes never mounts at all; its
`@destroy` still runs.

**`@create` is for initialisation, not side effects.** Besides having no DOM, it
runs while the instance it replaces is still alive: on a `key` change or a
swapped class, the new `@create` fires before the old `@destroy`. That ordering
is deliberate and stays — keeping the phase free of outside effects is what makes
it harmless. Take nothing exclusive there; `@mount` is the place.

`@destroy` runs exactly once, and also for a component whose **build failed** —
a throw in `render()` or in `@create` itself. So it may see a half-initialised
instance and has to tolerate that. The alternative, skipping cleanup for a
component that never finished, leaks whatever `@create` already took.

**Every method is bound to its instance**, so `onClick={this.handleClick}` works
with no constructor and no `.bind(this)` — including methods inherited from a
base class.

The one exception is an **underscore-prefixed method**, which is deliberately
left unbound. Binding is not free and scales with how many methods a class has —
per instance, construction alone against construction plus binding everything:

| methods | no binding | with binding |
| --- | --- | --- |
| 4 | 0.018 µs | 0.195 µs |
| 8 | 0.026 µs | 0.480 µs |
| 16 | 0.023 µs | 2.066 µs |

A 16-method component in a 1000-row list spends about 2ms on binding alone. So
`_helper()` is the way to say "this never travels as a callback, don't pay for
it". Ramonda reserves no `_` names of its own; the prefix is yours to use.

The trade: a `_` method detached from its instance loses `this`, and it fails
where it is *called* rather than where it was named. If a method is ever passed
as a callback, do not prefix it.

### State

`@state` turns a field into a signal. Assigning to it schedules a render; reading
it inside `render()` or a `@compute` records the dependency.

```tsx
@state items: Row[] = [];
@compute get total() { return this.items.length; }
```

Signals are **shallow by design** — there is no Proxy layer. A signal fires when
it is *assigned*, not when the value it holds is mutated inside, so replace
rather than mutate:

```tsx
this.items = [...this.items, next];   // ✅
this.items.push(next);                // ❌ reported as RMD005
```

### Hooks

A `Hook` is state and lifecycle **without an element** — the answer to everything
a function component would have been used for. Mount one with `this.use()`:

```tsx
class Timer extends Hook {
  @state seconds = 0;
  @interval(1000) tick() { this.seconds++; }
}

class Clock extends Component {
  timer = this.use(Timer);
  render() { return <span>{this.timer.seconds}</span>; }
}
```

### Lists

`For` is a hook, not a component — a `<For>` component would have to *be* an
element, so it could not put N siblings into the parent.

```tsx
rows = this.use(For<Row>, () => ({ each: this.items, as: RowView }));
render() { return <ul>{this.rows.nodes}</ul>; }
```

**It mints the keys itself.** A hand-written key is an identity you *assert*: it
can be derived from the index, typed wrong, forgotten, or collide, and a runtime
check catches it only if that branch happens to run. `For` takes identity from
the item — object reference, or the value for primitives — so there is nothing to
write and nothing to get wrong. `key: (item) => item.id` exists as an escape
hatch for when a replaced item should keep its component's state.

Use `as` for a component per item, `render: (item, index) => …` for plain markup.

### Lifecycle and events

| decorator | when |
| --- | --- |
| `@create` / `@mount` / `@destroy` | lifecycle; `{ env: "client" \| "server" \| "shared" }` |
| `@updated` | after every commit but the first; the DOM is the one you are looking at |
| `@watchProp(selector)` | syncs derived state *before* the render when a prop changes |
| `@onWindow` / `@onDocument` / `@onElement` | listeners, removed on unmount; typed from the event name |
| `@interval` / `@timeout` | timers that clear themselves on unmount |
| `@persist` | state that survives SSR → hydration |
| `@memoizedHandler` | a stable callback identity across renders |

Event handlers are typed from the name, via the DOM's own event maps:

```tsx
@onElement("click") onClick(e: MouseEvent) { … }     // ✅
@onDocument("keydown") onKey(e: KeyboardEvent) { … } // ✅
@onElement("click") onClick(e: KeyboardEvent) { … }  // ❌ does not compile
```

An unknown name — a custom event — is still accepted and arrives as `Event`.

### Server rendering

```ts
const html = await renderToString(<App />);   // on the server
hydrateRoot(<App />, container);              // on the client
```

Hydration **adopts** the server's DOM rather than rebuilding it — measured, not
assumed: see `apps/playground-ssr`, which carries a live adoption check. In DEV,
a server/client divergence is reported as RMD007 at the comparison the adopt path
had to make anyway, so there is no second render.

## Diagnostics

DEV builds report design mistakes with a code, what happened, and what to do
instead — `RMD001` (state written during render), `RMD005` (array mutated in
place), `RMD007` (server/client divergence), and so on. Every one is wrapped in
`if (__DEV__)`, so production strips the checks and the messages.

## Documentation

- `docs/AsyncLoad.md` — lazy components, failure handling, retry
- `BUGS.md` — every bug found, how it was proven, and what was rejected
- `TODO.md` — what is next and what was measured

## Development

```bash
pnpm test          # 360 tests
pnpm build
```


The full documentation site — get started, tutorial, every feature explained with running
examples, diagnostics reference, REPL — is planned in [`apps/docs/PLAN.md`](../../apps/docs/PLAN.md).
This README stays the package-level entry point; it is not a substitute for that.