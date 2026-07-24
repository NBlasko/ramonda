---
title: act
description: Why it exists, what it flushes, and the mistake it prevents.
section: Testing
order: 102
---

# `act`

```tsx
act(() => {
  instance.count = 5;
});
expect(getByText("5")).toBeTruthy();
```

When it returns, every render, `@mount` and effect the callback caused has run —
however deep the cascade went.

## Why it exists

A state write doesn't touch the DOM immediately — it schedules a render on a
microtask, so several writes become one render. Great for an app, and the sharpest
edge in testing one: an assertion right after a write reads the *old* DOM. `act`
removes the question — there is nothing to count or await.

## Where it's already applied

`render`, `rerender`, `fireEvent` and `renderHook` wrap themselves in `act`. You reach
for it directly when a test changes state **by hand** — common in Ramonda, because
state is a field, not something only an event can reach.

## The async form

```tsx
await act(async () => {
  await loadUser();
});

const user = await act(() => loadUser()); // the value passes through
```

If the callback returns a promise, so does `act`, and it awaits the callback before
flushing.

## What it doesn't do

It doesn't travel forward in time — it commits work already scheduled, not a real
timer or a network round trip. For those, use `waitFor`:

```tsx
setTimeout(() => act(() => {
  instance.count = 42;
}), 10);
await waitFor(() => expect(getByText("42")).toBeTruthy());
```

## Next

- [Testing hooks](/testing/hooks).
