---
title: Rendering and querying
description: render, the bound queries, and driving a component through its instance.
section: Testing
order: 101
---

# Rendering and querying

```tsx
const { container, getByText, instance, rerender, unmount } = render(<Card title="a" />);
```

Synchronous. `bootstrap` builds the tree and runs `@mount` before it returns, and `render` commits
anything those wrote — so there is nothing left to await, and no guessing how many ticks a cascade
needed.

Queries are bound to `baseElement` (`document.body`), matching the DOM Testing Library
convention, so anything rendered outside the container is still found.

## Options

| | |
|---|---|
| `container` | render into this element instead of a fresh `<div>`. Yours, so cleanup empties it but does not remove it |
| `baseElement` | what queries bind to, and where a created container is appended |
| `wrapper` | a component mounted above the tree — a context provider, a router shell |
| `hydrate` | adopt server markup: `true` for what is already in `container`, or **a string** of markup |

## `instance` — driving a component directly

In a framework whose state lives in closures, the only way in is an event. In Ramonda state is a
field on an object, so a test can be explicit:

```tsx
const { instance, getByText } = render<Counter>(<Counter />);

act(() => { instance.count = 41; });
expect(getByText("count is 41")).toBeTruthy();
```

Use it to reach a state that would take six clicks to set up. Test the six clicks too, through
`fireEvent` — the two answer different questions.

## `rerender` diffs

```tsx
const { instance, rerender, getByText } = render<Card>(<Card title="a" />);

act(() => { instance.hits = 7; });
rerender(<Card title="b" />);

expect(getByText("b:7")).toBeTruthy();   // not "b:0"
```

The instance survives, its `@state` survives, `@create` does not run again and `@watchProp` fires
— exactly what happens when a real parent re-renders a child with new props. That makes it the way
to test prop reactivity.

## `fireEvent` is wrapped

```tsx
fireEvent.click(getByText("count is 0"));
expect(getByText("count is 1")).toBeTruthy();
```

Import it from this package, not from `@testing-library/dom`. Dispatch is synchronous but the
render it triggers is not, so the unwrapped version leaves the assertion one tick early and reads
the DOM as it was *before* the click.

## Also on the result

| | |
|---|---|
| `asFragment()` | the container's content, detached — for snapshots |
| `debug(el?)` | prints formatted HTML |
| `unmount()` | runs `@destroy` and every cleanup |

## Next

- [act](/testing/act) — the one concept to actually understand.
