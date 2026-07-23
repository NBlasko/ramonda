---
title: Timers
description: "@interval and @timeout start on mount and are cleared on unmount."
section: Core concepts
order: 39
---

# Timers

```tsx
@interval(1000)
tick() { this.now = new Date(); }

@timeout(3000)
giveUp() { this.state = "timeout"; }
```

`@interval` runs the method every `ms` for the component's lifetime. `@timeout` runs it once,
`ms` after mount. Both are cleared when the component is destroyed.

```demo:IntervalClock
```

```demo:TimeoutReveal
```

## Why not just call setTimeout

Because the clearing is the hard part, and it is the part that gets forgotten.

```tsx
@mount
start() {
  setTimeout(() => { this.done = true; }, 3000);   // ✗
}
```

That timer survives the component. Three seconds later it writes state into something that no
longer exists — which Ramonda drops (`RMD008`), so the symptom is not a crash but a handler that
silently does nothing, on a page that has moved on.

With `@timeout` there is nothing to remember.

## Client only

Both are built on [effects](/concepts/effects), so neither runs during a server render. A
prerendered page ships without any timer running, and they start when the client takes over.

That is also why a clock reads its first value in `@mount({ env: "client" })` rather than in a
field initializer: a time rendered on the server would not match the time on the client, and
hydration would report the mismatch (`RMD007`). Render something stable, fill it in once the
client is running.

## RMD006 — a timer that outlived its component

In development, a timer still running after its component was destroyed is reported by name.
With `@interval` and `@timeout` you cannot cause it; the check is there for raw `setInterval`
calls, whoever started them.

## Next

- [Refs](/concepts/refs) — reaching the element itself.
