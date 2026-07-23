---
title: Testing hooks
description: renderHook mounts a hook on its own throwaway component.
section: Testing
order: 103
---

# Testing hooks

```tsx
const { current, rerender, unmount } = renderHook(CounterHook, {
  initialOptions: { start: 2 },
});

expect(current.count).toBe(2);

act(() => current.increment());
expect(current.count).toBe(3);
```

## It really mounts a component

A Ramonda hook cannot stand alone — `use()` gives it its owner's runtime, and that runtime is what
its lifecycle, effects and option signals hang off. So `renderHook` builds a throwaway host
component and uses the hook on it.

There is no lighter way that still exercises the same machinery, and a lighter way that did not
would be testing something other than what ships.

## `current` does not change between renders

Unlike a function-hook library, where the whole point is that each render returns a fresh value:

```tsx
const first = result.current;
act(() => result.current.increment());
expect(result.current).toBe(first);   // ✓ same object
```

A Ramonda hook is constructed once by `use()` and lives as long as its owner. **The instance is
the identity; the fields are what change.** Read a field to see the current value.

## `rerender(options)` drives the real path

```tsx
rerender({ start: 99 });
```

Options reach a hook through signals owned by the **caller**, updated when the caller re-renders.
Passing new options here drives that same path, so anything that reacts to an option reacts
exactly as it would under a real parent.

## `wrapper`

For a hook that needs a provider above it:

```tsx
renderHook(ThemedHook, { wrapper: ThemeShell });
```

## Testing a hook through a component instead

Sometimes clearer, especially when the hook's whole job is to affect what its owner renders:

```tsx
class Owner extends Component {
  counter = this.use(CounterHook, { start: 5 });
  render() { return <p>{this.counter.count}</p>; }
}

const { instance, getByText } = render<Owner>(<Owner />);
act(() => instance.counter.increment());
expect(getByText("6")).toBeTruthy();
```

Both are real. `renderHook` is for testing the hook's own behaviour; a component is for testing
what the hook does *to* a render.

## Next

- [Testing server rendering](/testing/ssr).
