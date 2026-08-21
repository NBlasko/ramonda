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
    return <span onclick={this.bump}>clicked {this.clicks} times</span>;
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
| Vite 7 (esbuild) client build, with a JSX transform configured | stripped ✅ |
| Vite 7 client build, with no JSX transform at all | **survive** ❌ |
| Vite 7 `--ssr` build | **survive** ❌ |
| Vite 8 (oxc), any mode | **survive** ❌ |

The Vite 7 row that works does so *by accident*: the JSX transform adds an import to
every module, which forces each one through the esbuild transform, and that
transform is what removes the decorators. Take the JSX transform away for an unrelated
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

`@created` runs while the component is being built — before its element exists.
`@mounted` runs after the DOM is committed, so by then the element **is** in the
document: measure it, focus it, hand it to a library. `@destroyed` runs on teardown.

Within one commit the order is: every child's `@mounted` before its parent's, and
per component `@mounted` before its effects — so listeners registered by
`@onElement` are live by the time `@mounted` runs.

A component torn down before the commit finishes never mounts at all; its
`@destroyed` still runs.

**`@created` is for initialisation, not side effects.** Besides having no DOM, it
runs while the instance it replaces is still alive: on a `key` change or a
swapped class, the new `@created` fires before the old `@destroyed`. That ordering
is deliberate and stays — keeping the phase free of outside effects is what makes
it harmless. Take nothing exclusive there; `@mounted` is the place.

`@destroyed` runs exactly once, and also for a component whose **build failed** —
a throw in `render()` or in `@created` itself. So it may see a half-initialised
instance and has to tolerate that. The alternative, skipping cleanup for a
component that never finished, leaks whatever `@created` already took.

**Every method is bound to its instance**, so `onclick={this.handleClick}` works
with no constructor and no `.bind(this)` — including methods inherited from a
base class.

There is no opt-out, and there used to be: a method whose name began with `_` was
left unbound, as "internal by convention". That was removed, because the
convention is not this framework's to claim. typescript-eslint's
`naming-convention` rule is commonly set to `leadingUnderscore: "require"` for
private members, so a project with that rule wrote `private _apply()` and got a
method that silently did not bind — `onclick={this._apply}` then lost `this`,
with no error and no diagnostic. A lint rule chosen for unrelated reasons broke
the framework's central promise about methods.

It also bought very little. Per instance, binding every method against binding
all but a third of them:

| methods | construct | bind all | bind all but N | saved | per 1000 instances |
| --- | --- | --- | --- | --- | --- |
| 3 | 22 ns | 146 ns | 105 ns | 41 ns | 0.04 ms |
| 5 | 29 ns | 253 ns | 243 ns | 10 ns | 0.01 ms |
| 8 | 32 ns | 352 ns | 268 ns | 84 ns | 0.08 ms |
| 12 | 29 ns | 565 ns | 353 ns | 212 ns | 0.21 ms |

A fifth of a millisecond across a thousand rows, at twelve methods, in exchange
for a silent `this`-loss. If an opt-out is ever wanted back it will be an explicit
`@unbound` decorator: it says what it does where it does it, and no lint rule can
trigger it by accident.

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

`list()` is a function call in an expression slot, not a component — a `<List>` tag would have to
*be* an element, so it could not put N siblings into the parent.

```tsx
render() {
  return <ul>{list(this.items, (item) => <RowView item={item} />)}</ul>;
}
```

**It does not iterate where you write it.** Nothing has run when that line
finishes — what comes back is a description, and your callback is called by the
framework while it reconciles the rows. So a list whose array did not change costs
nothing: the callback is never called and no row is touched.

**Identity is the item, and your `key` where the item cannot answer.** While a row
is the same object it is the same row, which covers every update that keeps its
references. The moment an object is new — a refetch, an array built in a
`@compute` — write a key from your data: `<RowView key={item.id} item={item} />`.

The callback takes the item alone. There is no index: a row that shows its position
must be rebuilt whenever it moves, and an index must never become a row's identity,
because it follows the position rather than the row.

### Lifecycle and events

| decorator | when |
| --- | --- |
| `@created` / `@mounted` / `@destroyed` | lifecycle; `{ env: "client" \| "server" \| "shared" }` |
| `@updated` | after every commit but the first; the DOM is the one you are looking at |
| `@watchProp(selector)` | syncs derived state *before* the render when a prop changes |
| `@onWindow` / `@onDocument` / `@onElement` | listeners, removed on unmount; typed from the event name |
| `@interval` / `@timeout` | timers that clear themselves on unmount |
| `@persist` | state that survives SSR → hydration |
| `@memoized` | a stable callback identity across renders |

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

- [ramonda.dev](https://ramonda.dev) — the documentation site: getting started, every
  feature with running examples, the API and diagnostics references
- [`DIAGNOSTICS.md`](./DIAGNOSTICS.md) — every `RMD` code, what raises it and what to do about it

## Development

```bash
pnpm test
pnpm build
```


The full documentation site — get started, every feature explained with running examples, the API
and diagnostics references — lives at [ramonda.dev](https://ramonda.dev). This README
stays the package-level entry point; it is not a substitute for that.