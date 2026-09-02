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
click instead, see [`Timeout` and `Interval`](#a-timer-that-starts-when-you-say) below. **Both stop automatically
when the component is removed** — there is nothing to clean up.

```demo:IntervalClock
```

```demo:TimeoutReveal
```

## When the tick must not re-render

The clock above writes `@state` every second, so the component renders every second. That is the
right default and it is cheap — one component, and a diff that finds one changed text node — but it
is still a render, and a component with a large subtree pays for the whole of it once a second.

Where that matters, hold a [ref](/concepts/refs) and write the node yourself:

```tsx
import { createRef, interval } from "@ramonda/core";

class Clock extends Component {
  private readout = createRef<HTMLSpanElement>();

  @interval(1000)
  tick() {
    // No state, so no render: the text is written straight to the node.
    if (this.readout.current) this.readout.current.textContent = new Date().toLocaleTimeString();
  }

  render() {
    return <span ref={this.readout} />;
  }
}
```

**What you give up is what makes it cheaper.** The value is no longer state, so it does not travel in
the SSR payload, `@persist` cannot keep it, devtools does not show it, and nothing else in the
component can derive from it — a `@compute` reading it would never be told it moved. The node is also
empty until the first tick, where the state version renders its initial value immediately.

So: `@state` unless the tick is expensive, and a ref when it is. Reaching for the ref first is the
optimisation nobody asked for.

## A timer that starts when you say

`@interval` and `@timeout` start at mount. When the clock starts on a click instead — a
delay before a row is removed, a deadline inside a promise, a retry after a failure —
use the `Timeout` and `Interval` hooks:

```tsx
import { Component, state, Timeout } from "@ramonda/core";

export class Row extends Component<{ id: number; onRemove: (id: number) => void }> {
  @state leaving = false;
  private removal = this.use(Timeout, () => ({ run: this.remove }));

  leave() {
    this.leaving = true;
    this.removal.start(3000);
  }

  stay() {
    this.removal.stop();
    this.leaving = false;
  }

  private remove() {
    this.props.onRemove(this.props.id);
  }

  render() {
    return <li className={this.leaving ? "leaving" : ""} onclick={this.stay} />;
  }
}
```

```demo:TimerOnClick
```

`start(ms)` runs `run` once, `ms` from now — `Interval` runs it every `ms` instead. `stop()`
clears it, and **teardown clears it too**, which is the whole reason to reach for these
rather than a raw timer.

`start` **returns whether it started**. Ignore that for a timer that is only a timer; check
it when something is waiting on the callback, because `false` means the callback will never
run:

```tsx
if (!this.deadline.start(1000)) this.settle();
```

## What goes where, and when it is read

**`run` belongs to the hook** and is read **when the call fires**. So a `run` chosen by a
signal takes effect on a call that is already waiting, without restarting the countdown:

```tsx
private beat = this.use(Interval, () => ({ run: this.paused ? this.hold : this.tick }));
```

Swapping it cancels nothing. Cancelling is `stop()`, always explicit — the props callback
re-runs whenever any signal it read changes, including one read for something else, so a
timer that cancelled itself on that would be a timer an unrelated re-render could kill.

**`ms` belongs to `start`** and is read there. A delay is a property of *this* start — a
retry's backoff differs every time — so it is an argument rather than a value to watch:

```tsx
retry() {
  this.attempt.start(this.backoff);
}
```

**One hook instance is one timer.** Starting a running one restarts it, so `stop()` never
has to ask which and no handle travels back to the caller. Two timers means two hooks:

```tsx
private removal = this.use(Timeout, () => ({ run: this.dropRow }));
private deadline = this.use(Timeout, () => ({ run: this.giveUp }));
```

Nothing starts during a server render — a timer could not fire before the response is sent.
`start` returns `false` there rather than throwing, so the same method is safe to call from
code that runs on both sides. It returns `false` once the component is gone too, for the
same reason: nothing would ever clear a timer started after teardown.

A delay that is not a finite, non-negative number of milliseconds throws — **in every build,
not only in development.** The delay arrives at runtime, so `undefined` from an API would
otherwise be a `setTimeout(fn, 0)` in production and a loud error on your machine. The
ceiling is `2147483647` ms, about 24.8 days, because `setTimeout` truncates anything larger
and fires it immediately.

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
`@timeout` and the `Timeout` hook both leave nothing to forget.

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
