# @ramonda/testing-library

Testing utilities for Ramonda components and hooks, built on
[`@testing-library/dom`](https://testing-library.com/docs/dom-testing-library/intro).

[![npm](https://img.shields.io/npm/v/%40ramonda%2Ftesting-library)](https://www.npmjs.com/package/@ramonda/testing-library)
[![license](https://img.shields.io/npm/l/%40ramonda%2Ftesting-library)](https://github.com/NBlasko/ramonda/blob/main/LICENSE)

```bash
pnpm add -D @ramonda/testing-library @testing-library/dom
```

Documentation: **[ramonda.dev/testing](https://ramonda.dev/testing)**

```tsx
import { render, screen, fireEvent, act } from "@ramonda/testing-library";

test("counts up", () => {
  render(<Counter start={2} />);

  fireEvent.click(screen.getByRole("button"));

  expect(screen.getByText("count: 3")).toBeTruthy();
});
```

No `await`, no `settle()`, no cleanup call. That is the whole point of the
package.

## What this adds, and what it does not

The queries, `screen`, `waitFor`, `within` and `prettyDOM` are **not**
reimplemented here — they are the DOM Testing Library's, re-exported. That
library is framework-agnostic on purpose, it is where the query semantics people
already know come from, and a from-scratch copy would be a worse version of it
that also has to be maintained. Anything you can import from
`@testing-library/dom`, you can import from here.

Three things are ours, because only Ramonda can know them:

| | why it cannot come from the DOM library |
|---|---|
| `act` | Ramonda batches renders through a microtask. Only the framework knows when the queue is empty. |
| `render` / `renderHook` | Mounting a Ramonda tree, and diffing a re-render into it. |
| `fireEvent` | The DOM library's, wrapped so the render an event causes is committed before it returns. |

`cleanup` is the fourth, and it runs itself.

## `act` — the reason this package exists

A Ramonda state write does not touch the DOM immediately; it schedules a render
on a microtask, so several writes in one turn produce one render. Excellent for
an app, and the single sharpest edge in testing one: an assertion made straight
after a write reads the **old** DOM.

The harness this package replaces exposed that edge directly. It offered
`settle: () => Promise.resolve()` and left the count to you — one `await` for a
simple change, two or three for a cascade, discovered by trying. One too few and
the test read stale DOM; the fix was to add another and hope.

`act` removes the question. When it returns, every pending render, every
`@mounted` and every effect has run — however deep the cascade went:

```ts
act(() => { instance.count = 5; });
expect(getByText("5")).toBeTruthy();
```

It is synchronous, because Ramonda's commit is. If the callback returns a
promise, so does `act`, and its value passes through:

```ts
const user = await act(() => loadUser());
```

`render`, `rerender`, `fireEvent` and `renderHook` already wrap themselves in it.
Reach for it directly when a test changes state **by hand** — which in Ramonda is
common, because state is a field on a component instance, not something only an
event can reach.

`act` commits work that is already scheduled; it does not travel forward in time.
A real timer or a network round trip still wants `waitFor`.

## `render`

```ts
const result = render(<Card title="a" />, options?);
```

**Options**

| option | |
|---|---|
| `container` | Render into this element instead of a fresh `<div>`. Yours, so cleanup empties it but does not remove it. |
| `baseElement` | What queries bind to, and where a created container is appended. Defaults to `document.body`. |
| `wrapper` | A component mounted above the tree — a context provider, a router shell. It receives the rendered node as children. |
| `hydrate` | Adopt server markup instead of building the DOM. `true` hydrates what is already in `container`; **a string is the markup itself**. |

### `hydrate` — testing SSR output

```tsx
const html = await renderToString(<App />);

const { getByText } = render(<App />, { hydrate: html });
```

Pass the markup as a string and the harness owns the container, which means
automatic cleanup covers it. `hydrate: true` is the other form: it adopts
whatever is already in a `container` you supplied, and that container is then
yours to remove.

Prefer the string form. Hydration tests are where a leaked tree hurts most —
whatever the server rendered stays live, and the next test hydrates on top of it.

**Result**

Every bound query (`getByText`, `findByRole`, …), plus:

| | |
|---|---|
| `container` | The element rendered into. `container.firstChild` is the component's own host — the harness adds no wrapper of its own. |
| `baseElement` | What the queries are bound to. |
| `instance` | The root component instance, typed via `render<Counter>(…)`. |
| `rerender(ui)` | New JSX into the same container, **diffed**. |
| `unmount()` | Runs `@destroyed` and every cleanup. |
| `asFragment()` | The container's content, detached — for snapshots. |
| `debug(el?)` | Prints formatted HTML. |

### `instance` — driving a component directly

State is a field on an instance, so a test can be explicit about what changed
rather than reproducing the gesture that would have changed it:

```tsx
const { instance, getByText } = render<Counter>(<Counter />);

act(() => { instance.count = 41; });
expect(getByText("count: 41")).toBeTruthy();
```

Use it to set up a state that would take six clicks to reach. Test the six clicks
too — through `fireEvent`, the way a user gets there.

### `rerender` really diffs

```tsx
const { instance, rerender, getByText } = render<Card>(<Card title="a" />);

act(() => { instance.hits = 7; });
rerender(<Card title="b" />);

expect(getByText("b:7")).toBeTruthy();   // not "b:0"
```

The instance survives, its `@state` survives, `@created` does not run again and
`@watchProp` fires — exactly what happens when a real parent re-renders a child
with new props. That makes it the way to test prop reactivity.

## `renderHook`

A Ramonda hook cannot stand alone: `use()` hands it its owner's runtime, and that
runtime is what its lifecycle, effects and option signals hang off. So
`renderHook` really does mount a component. There is no lighter way that still
exercises the same machinery, and a lighter way that did not would be testing
something other than what ships.

```ts
const { current, rerender, unmount } = renderHook(CounterHook, {
  initialProps: { start: 2 },
});

expect(current.count).toBe(2);

act(() => { current.increment(); });
expect(current.count).toBe(3);
```

**`current` does not change between renders.** A Ramonda hook is constructed once
and lives as long as its owner, so `current` is the same object throughout — the
instance is the identity, the fields are the state. (A function-hook library has
to return a new value each render; this one does not.)

**`rerender(options)`** replaces the options bag the way a re-rendering owner
would, driving the same option signals. Anything that reacts to an option reacts
here identically.

`wrapper` works the same as in `render`, for a hook that needs a provider above
it.

## `cleanup`

Every rendered tree is unmounted after each test, automatically, when the test
framework exposes a global `afterEach` (vitest with `globals: true`, or jest).
Otherwise call `cleanup()` yourself.

**It is not tidiness.** Two failures measured on the ad-hoc harness this replaces:

1. A leaked container keeps a **live** tree. Its `@interval`s keep firing and its
   window listeners stay attached, into whatever test runs next.
2. Ids stop being unique across containers, and jsdom resolves even a *scoped*
   `container.querySelector("#x")` through a document-wide index — so a query
   returns a node from an **earlier** test. Those tests pass one at a time and
   fail together, which points the blame at the wrong file entirely.

Neither looks like a leak from the outside. To opt out anyway:

```ts
import "@ramonda/testing-library/dont-cleanup-after-each";
```

or set `RAMONDA_TL_SKIP_AUTO_CLEANUP`.

## Setup

```ts
// vitest.config.ts
export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "@ramonda/core" },
  test: { globals: true, environment: "jsdom", setupFiles: ["./test/setup.ts"] },
});
```

There is no setup file to write for JSX. With the automatic runtime the compiler imports what it
needs per file, so nothing has to be put on `globalThis` and there is no factory name to keep in
step with the config.

`globals: true` is what lets cleanup register itself. Add
`@testing-library/jest-dom` to the setup file if you want its matchers.

## How it reaches the framework

Through `@ramonda/core/testing`, a deliberately separate entry point exporting
exactly three things: `flushSync`, `rerenderRoot` and `getComponentInstance`.

Core's main entry is guarded by tests whose whole job is to keep the internals
out of what an application can import. A harness genuinely needs three of them —
so rather than widen the app-facing API permanently to make a test utility
possible, there is a second, narrow door, pinned by its own tripwire.

## License

[MIT](../../LICENSE) © Nikola Blagojević
