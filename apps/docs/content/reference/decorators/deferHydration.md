---
title: deferHydration
description: Holds a subtree exactly as the server wrote it until a promise settles, so finished content does not flash back into a spinner.
section: Reference
order: 124
---

# `@deferHydration`

Declares the method that says **when this component may hydrate**. Until the promise it returns
settles, the subtree is left exactly as the server wrote it.

```tsx
class Panel extends Component {
  @deferHydration
  untilReady() {
    return this.load();
  }

  load(): Promise<void> {
    return Promise.resolve();
  }
}
```

## The problem it exists for

Hydration adopts the server's DOM by rendering the same tree in the browser and matching it up. A
component whose output depends on something **not ready yet** renders a fallback instead — and the
fallback does not match, so the real markup is replaced by it.

The reader watches finished content flash into a spinner. That is the whole fault, and it only
happens on a page that was already correct.

`AsyncLoad` uses this for you. You need it yourself only if you build something with the same
shape: markup the server could produce and the browser cannot, until something loads.

## What it refuses

**Anything but a method.** It has to call something to get a promise.

## What it costs

The subtree stays **inert** until the promise settles: server markup on screen, no listeners
attached, nothing interactive inside it. That is the trade — correct pixels instead of early
clicks — and a promise that never settles is a subtree that never wakes up.

## Next

- [Async work on the server](/ssr/async) — where the deferral fits.
- [Hydration mismatches](/ssr/mismatches) — the fault this avoids, in general.
- [Lazy loading](/composition/lazy) — `AsyncLoad`, which uses this.
