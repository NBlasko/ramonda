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

Synchronous: `render` builds the tree, runs `@mounted`, and commits anything they wrote
— so there is nothing left to await. Queries are bound to `document.body` (the DOM
Testing Library convention), so content rendered outside the container is still found.

## Options — `RenderOptions`

| | |
|---|---|
| `container` | render into this element instead of a fresh `<div>` |
| `baseElement` | what queries bind to |
| `wrapper` | a component mounted above the tree — a context provider, a router shell |
| `hydrate` | adopt server markup: `true` for what's already in `container`, or a **string** of markup |

`render` hands back a `RenderResult`: the `container`, the bound queries, `rerender`, `unmount`, and
the `instance` below. A `wrapper` in the options is a `WrapperComponent` — a component taking
`children`, for a provider a test needs above the subject.

## `instance` — driving a component directly

Because state is a field on an object, a test can set it directly instead of finding
an event that would:

```tsx
const { instance, getByText } = render<Counter>(<Counter />);

act(() => {
  instance.count = 41;
});
expect(getByText("count is 41")).toBeTruthy();
```

Use it to reach a state that would take six clicks to set up — and test the six clicks
too, through `fireEvent`. They answer different questions.

## `rerender` diffs new props in

```tsx
const { instance, rerender, getByText } = render<Card>(<Card title="a" />);

act(() => {
  instance.hits = 7;
});
rerender(<Card title="b" />);

expect(getByText("b:7")).toBeTruthy(); // not "b:0"
```

The instance survives, its `@state` survives, `@created` doesn't run again, and
`@watchProp` fires — exactly like a real parent re-rendering a child with new props.
That makes it how you test prop reactivity.

## `fireEvent` is wrapped

```tsx
fireEvent.click(getByText("count is 0"));
expect(getByText("count is 1")).toBeTruthy();
```

Import it from this package, not `@testing-library/dom` — the render a click triggers
isn't synchronous, so the unwrapped version reads the DOM one tick too early.

## Also on the result

`asFragment()` (detached content, for snapshots), `debug(el?)` (prints HTML),
`unmount()` (runs `@destroyed` and every cleanup).

## Next

- [act](/testing/act) — the one concept to actually understand.
