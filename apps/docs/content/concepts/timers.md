---
title: Timers
description: Run something on a clock or after a delay — started and cleaned up for you.
section: Lifecycle and subscriptions
order: 33
---

# Timers

To run something on a clock — a ticking time, a delayed reveal — use `@interval` or
`@timeout`:

```tsx
@state now = "";

@interval(1000)
tick() {
  this.now = new Date().toLocaleTimeString();
}

@timeout(3000)
giveUp() {
  this.status = "timeout";
}
```

(Note `now` holds a **string**, not a `Date`. State can be serialised — for the SSR
payload or `@persist` — and a `Date` instance doesn't round-trip through that, so
keep state to plain, serialisable values and format for display.)

`@interval` runs the method every `ms` for as long as the component is on the page.
`@timeout` runs it once, `ms` after the component mounts. **Both stop automatically
when the component is removed** — there is nothing to clean up.

```demo:IntervalClock
```

```demo:TimeoutReveal
```

## Why not a plain setTimeout?

Because remembering to clear it is the part that gets forgotten:

```tsx
@mount
start() {
  setTimeout(() => {
    this.done = true;
  }, 3000); // ✗
}
```

That timer outlives the component. Three seconds later it tries to change state on
something that is already gone — Ramonda drops the write (`RMD008`), so the bug isn't
a crash but a handler that quietly does nothing on a page that has moved on.
`@timeout` leaves nothing to forget.

## Only in the browser

Both are built on [subscriptions](/concepts/subscriptions), so neither runs during a server
render — a prerendered page ships with no timer running, and they start when the
browser takes over.

That is also why a clock fills in its first value in `@mount({ env: "client" })`, not
in the field itself: a time rendered on the server wouldn't match the browser's, and
hydration would flag the mismatch. Show something steady first, then fill it in.

## Next

- [Refs](/concepts/refs) — reaching the element itself.
