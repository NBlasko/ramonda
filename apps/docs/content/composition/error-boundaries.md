---
title: Error boundaries
description: Catch what a subtree throws while rendering, and offer a way back.
section: Composition
order: 73
---

# Error boundaries

```tsx
<ErrorBoundary
  fallback={({ message, reset }) => (
    <p className="error">
      Something broke: {message} <button onClick={reset}>try again</button>
    </p>
  )}
>
  <Report data={this.data} />
</ErrorBoundary>
```

```demo:ErrorBoundaryDemo
```

Break it, and everything **outside** the boundary keeps working. That is the reason to place
boundaries around the parts of a page that can fail independently — a widget, a panel, a route —
rather than one at the root.

## `fallback` is a function

Not a node. It receives:

| | |
|---|---|
| `message` | the error message |
| `err` | the `Error`, when there was one |
| `reset` | clears the boundary and renders the subtree again |

`reset` is why it is a function. Without it a boundary is a dead end, and the only way back is a
page reload.

```tsx
fallback={({ reset }) => <button onClick={reset}>Retry</button>}
```

Note that `reset` alone re-renders the same subtree — if whatever made it throw is still true, it
will throw again. Fix the cause first, then reset, as the demo does.

## What it catches

Errors thrown **while rendering** the subtree: in `render()`, in `@create`, in a `@compute` a
render read.

What it does not catch:

- **Event handlers.** A click that throws is not part of a render. Use `try/catch`.
- **Async work.** A rejected promise resolves outside the render — catch it and put the failure
  in state.
- **Errors after the commit.** An `@effect` that throws is reported, not caught here.

The boundary is drawn at render for a reason: rendering is the only phase the framework controls
end to end.

## Loading failures have their own shape

`AsyncLoad` takes an `errorFallback` with the same signature — `{ error, retry }` — on purpose.
One shape to learn for the same job. See [lazy loading](/composition/lazy).

## Next

- [Lazy loading](/composition/lazy) — deferring a module until it is rendered.
