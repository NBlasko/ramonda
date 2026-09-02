---
title: timeout
description: Run a method once after so many milliseconds — cancelled if the component leaves first.
section: Reference
order: 135
---

# `@timeout`

Runs a method **once**, `ms` after the component mounts. If the component is removed first, it never
runs.

## The situation it is for

A confirmation that fades itself out. It appears when something succeeded, and it has to disappear
four seconds later — unless the reader navigates away first, in which case the timer must not
outlive the page it belongs to:

```tsx
class Toast extends Component<{ message: string }> {
  @state shown = true;

  @timeout(4000)
  hide() {
    this.shown = false;
  }

  render() {
    return this.shown ? <p role="status">{this.props.message}</p> : null;
  }
}
```

That cancellation is the point. A raw `setTimeout` whose callback writes state after the component
is gone is reported as [`RMD008`](/reference/diagnostics/rmd008) — the write is dropped and the
render it asked for never happens.

## What it refuses

The delay is checked where it is **written**, at class-definition time, and by exactly the rules
[`@interval`](/reference/decorators/interval) uses: a number, finite, not negative, and at most
2,147,483,647 ms — beyond which `setTimeout` truncates and the callback fires **immediately**
instead of late.

**Anything but a method.**

## What it costs, and when not to reach for it

It starts at mount and only at mount. A delay that begins when something *happens* — a click, a
response — is the `Timeout` hook instead, which you start and stop yourself:

```tsx
class Confirm extends Component {
  private undo = this.use(Timeout, () => ({ run: this.commit }));

  askedFor() {
    this.undo.start(5000);
  }

  cancel() {
    this.undo.stop();
  }

  commit() {}
}
```

**It is browser-only**, for the same reason as [`@interval`](/reference/decorators/interval): both
are built on the effect primitive, and effects never run during a server render.

## Next

- [Timers](/concepts/timers) — both decorators, both hooks, and what goes where.
- [`@interval`](/reference/decorators/interval) — every time, instead of once.
