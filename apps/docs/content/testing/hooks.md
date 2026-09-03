---
title: Testing hooks
description: renderHook mounts a hook on its own throwaway component.
section: Testing
order: 103
---

# Testing hooks

```tsx
const { current, rerender, unmount } = renderHook(CounterHook, {
  initialProps: { start: 2 },
});

expect(current.count).toBe(2);

act(() => current.increment());
expect(current.count).toBe(3);
```

## It really mounts a component

A hook can't stand alone — `use()` gives it its owner's runtime. So `renderHook`
builds a throwaway host component and uses the hook on it, exercising the same
machinery that ships.

## `current` stays the same object — `RenderHookResult`

Unlike function-hook libraries, where each render returns a fresh value:

```tsx
const first = result.current;
act(() => result.current.increment());
expect(result.current).toBe(first); // ✓ same object
```

A Ramonda hook is constructed once and lives as long as its owner — the instance is
the identity, the fields are what change. Read a field for the current value.

## `rerender(props)` drives the real path

```tsx
rerender({ start: 99 });
```

A hook's props reach it through signals owned by the caller, updated when the caller
re-renders — so passing new props here makes anything that reacts to one react exactly
as it would under a real parent.

## `wrapper` — `RenderHookProps`

For a hook that needs a provider above it:

```tsx
renderHook(ThemedHook, { wrapper: ThemeShell });
```

## Or test it through a component

Sometimes clearer, especially when the hook's job is to affect what its owner renders:

```tsx
class Owner extends Component {
  counter = this.use(CounterHook, () => ({ start: 5 }));
  render() {
    return <p>{this.counter.count}</p>;
  }
}

const { instance, getByText } = render<Owner>(<Owner />);
act(() => instance.counter.increment());
expect(getByText("6")).toBeTruthy();
```

`renderHook` tests the hook's own behaviour; a component tests what the hook does *to*
a render.

## Next

- [Testing server rendering](/testing/ssr).
