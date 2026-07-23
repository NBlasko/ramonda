---
title: act
description: Why it exists, what it drains, and the mistake it prevents.
section: Testing
order: 102
---

# `act`

```tsx
act(() => { instance.count = 5; });
expect(getByText("5")).toBeTruthy();
```

When it returns, every pending render, `@mount` and effect has run — however deep the cascade
went.

## Why it exists

A Ramonda state write does not touch the DOM immediately. It schedules a render on a microtask, so
several writes in one turn produce one render. Excellent for an app, and the single sharpest edge
in testing one: an assertion made straight after a write reads the **old** DOM.

The harness this package replaced exposed that edge directly. It offered
`settle: () => Promise.resolve()` and left the count to you — one `await` for a simple change, two
or three for a cascade, discovered by trying. One too few and the test read stale DOM; the fix was
to add another and hope.

`act` removes the question. There is nothing to count.

## Where it is already applied

`render`, `rerender`, `fireEvent` and `renderHook` wrap themselves in it. You reach for it
directly when a test changes state **by hand** — which in Ramonda is common, because state is a
field rather than something only an event can reach.

## The async form

```tsx
await act(async () => { await loadUser(); });

const user = await act(() => loadUser());   // the value passes through
```

If the callback returns a promise, so does `act`, and it awaits the callback before flushing. It
also gives already-scheduled promise continuations a bounded number of turns to run — a `.then`
still queued when the callback resolved gets its chance.

## What it does not do

**It does not travel forward in time.** `act` commits work that is already scheduled; a real timer
or a network round trip is not. For those, use `waitFor`:

```tsx
setTimeout(() => act(() => { instance.count = 42; }), 10);
await waitFor(() => expect(getByText("42")).toBeTruthy());
```

## Next

- [Testing hooks](/testing/hooks).
