---
title: Timers
description: Run something on a clock or after a delay — started and cleaned up for you.
section: Lifecycle and subscriptions
order: 34
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
`@timeout` runs it once, `ms` after the component mounts. For a timer that starts on a
click instead, see [`Timer`](#a-timer-that-starts-when-you-say) below. **Both stop automatically
when the component is removed** — there is nothing to clean up.

```demo:IntervalClock
```

```demo:TimeoutReveal
```

## A timer that starts when you say

`@interval` and `@timeout` start at mount. When the clock starts on a click instead — a
delay before a row is removed, a deadline inside a promise, a retry after a failure —
use the `Timer` hook:

```tsx
import { Component, Timer, state } from "@ramonda/core";

export class Row extends Component<{ id: number; onRemove: (id: number) => void }> {
  @state leaving = false;
  private removal = this.use(Timer);

  leave() {
    this.leaving = true;
    this.removal.after(3000, this.remove);
  }

  private remove() {
    this.props.onRemove(this.props.id);
  }

  stay() {
    this.removal.stop();
    this.leaving = false;
  }

  render() {
    return <li className={this.leaving ? "leaving" : ""} onclick={this.stay} />;
  }
}
```

```demo:TimerOnClick
```

`after(ms, run)` runs `run` once. `repeat(ms, run)` runs it on a loop. `stop()` clears whichever is
armed, and **teardown clears it too** — which is the whole reason to reach for this
rather than a raw timer.

Both arming methods **return whether they armed**. Ignore it for a timer that is only a
timer; check it when something is waiting on the callback, because `false` means the
callback will never run:

```tsx
if (!this.deadline.after(1000, () => this.settle())) this.settle();
```

## What the callback sees, three seconds later

The body runs long after the click, so which values it reads is a decision — and the two
answers are both right, for different jobs. Say which one you mean:

```tsx
// The value AS IT IS WHEN IT FIRES. What a debounce wants: send whatever is in the box
// when the typing stops, not what was there when the last key landed.
private search = this.use(Timer);

typed() {
  this.search.after(300, this.send);
}

private send() {
  void fetch(`/search?q=${this.query}`);   // this.query, read now
}
```

```tsx
// The value AS IT WAS WHEN YOU ARMED IT. What a per-item action wants: remove the row that
// was clicked, whatever the list has done since. Keep it in state, where it is visible.
@state leavingId: number | null = null;
private removal = this.use(Timer);

remove(id: number) {
  this.leavingId = id;
  this.removal.after(3000, this.dropLeaving);
}

private dropLeaving() {
  const id = this.leavingId;
  if (id === null) return;
  this.leavingId = null;
  this.drop(id);
}
```

**Reach for a method rather than an inline function**, as both of these do. An arrow written
at the call site can capture a local *or* read `this.props` — measured, those give different
answers three seconds later — and nothing at the call site says which one you wrote. A named
method puts the reads where they can be read.

**One hook instance is one timer.** So `stop()` never has to ask which, and no handle
travels back to the caller. Arming an armed timer restarts it: `after` called twice runs
the body once, at the second delay. Two timers means two hooks:

```tsx
private removal = this.use(Timer);
private deadline = this.use(Timer);
```

Nothing is armed during a server render — a timer could not fire before the response is
sent. `after` and `repeat` return `false` there rather than throwing, so the same method is
safe to call from code that runs on both sides. They return `false` once the component is
gone too, for the same reason: nothing would ever clear a timer armed after teardown.

A delay that is not a finite, non-negative number of milliseconds throws — **in every
build, not only in development.** The delay here arrives at runtime, so `undefined` from an
API would otherwise be a `setTimeout(fn, 0)` in production and a loud error on your machine.
The ceiling is `2147483647` ms, about 24.8 days, because `setTimeout` truncates anything
larger and fires it immediately.

## Why not a plain setTimeout?

Because remembering to clear it is the part that gets forgotten:

```tsx
@mounted
start() {
  setTimeout(() => {
    this.done = true;
  }, 3000); // ✗
}
```

That timer outlives the component. Three seconds later it tries to change state on
something that is already gone — Ramonda drops the write (`RMD008`), so the bug isn't
a crash but a handler that quietly does nothing on a page that has moved on.
`@timeout` and `Timer` both leave nothing to forget.

## Only in the browser

Both are built on [subscriptions](/concepts/subscriptions), so neither runs during a server
render — a prerendered page ships with no timer running, and they start when the
browser takes over.

That is also why a clock fills in its first value in `@mounted({ env: "client" })`, not
in the field itself: a time rendered on the server wouldn't match the browser's, and
hydration would flag the mismatch. Show something steady first, then fill it in.

## Next

- [Refs](/concepts/refs) — reaching the element itself.
- [The decorator table](/reference/decorators) — both timers are client-only, and work on a hook.
