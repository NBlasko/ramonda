---
title: interval
description: Run a method every so many milliseconds for as long as the component is on the page — cleared for you when it leaves.
section: Reference
order: 126
---

# `@interval`

Runs a method every `ms` for as long as the component is on the page.

## The situation it is for

A "last synced 4 minutes ago" line. The value has to move on its own, and it has to stop moving the
moment the panel is closed:

```tsx
class Synced extends Component<{ at: number }> {
  @state ago = "just now";

  @interval(60_000)
  retime() {
    const minutes = Math.round((Date.now() - this.props.at) / 60_000);
    this.ago = minutes === 0 ? "just now" : `${minutes} minute(s) ago`;
  }

  render() {
    return <small>Last synced {this.ago}</small>;
  }
}
```

Written with `setInterval` this needs three things: somewhere to keep the id, a `@mounted` to start
it, and a `@destroyed` to clear it. Forget the third and the timer keeps firing after the panel
closes, writing state into a component that is gone —
[`RMD008`](/reference/diagnostics/rmd008).

**There is no id to keep and nothing to clear.** The timer starts when the component mounts and is
cleared when it is removed, so it cannot outlive the thing it belongs to — which is the whole reason
to reach for this instead of `setInterval`.

## What it refuses

The delay is checked where it is **written**, at class-definition time, not on the first tick:

- **Not a number**, or not finite → refused, naming what was passed. `@interval("1s")` is the
  common one.
- **Negative** → refused.
- **More than 2,147,483,647 ms** (about 24.8 days) → refused, and this one is not pedantry:
  `setTimeout` truncates to a 32-bit signed value, so a larger delay fires **immediately** rather
  than late.

**Anything but a method.**

## What it costs, and when not to reach for it

The delay is fixed at the class. A timer whose interval depends on state or a prop is not this — use
the `Interval` hook, which you start yourself:

```tsx
class Poller extends Component<{ every: number }> {
  private timer = this.use(Interval, () => ({ run: this.poll }));

  @mounted
  begin() {
    this.timer.start(this.props.every);
  }

  poll() {}
}
```

**It is browser-only, and for a stronger reason than "the server has no timers".** This is built on
the effect primitive, and effects never run during a server render — so a timer is not started and
then cleared there, it is never started at all. Which is correct: a server render produces one
string and is finished, and a clock that ticked during it would only delay the response.

**A tick that writes state re-renders.** That is usually the point, and when it is not, see
[Timers](/concepts/timers) for the value that moves without a render.

## Next

- [Timers](/concepts/timers) — the whole picture, including the tick that must not re-render.
- [`@timeout`](/reference/decorators/timeout) — once, instead of every time.
