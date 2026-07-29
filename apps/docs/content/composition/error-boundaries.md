---
title: Error boundaries
description: Catch an error from part of the page, keep the rest working, and offer a way back.
section: Composition
order: 53
---

# Error boundaries

If something goes wrong while a component is rendering, that error would normally
break the whole page. An **error boundary** catches it, keeps the rest of the page
working, and shows a fallback in place of the broken part.

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

Break the `Report` and everything *outside* the boundary keeps working. So put
boundaries around the parts of a page that can fail on their own — a widget, a panel,
a route — rather than one at the very top.

## The fallback is a function

It receives:

| | |
|---|---|
| `message` | the error message |
| `err` | the `Error` itself, if there was one |
| `reset` | clears the boundary and tries rendering the subtree again |

`reset` is why it is a function: without it, a boundary is a dead end and the only
way back is a page reload. Note that `reset` re-renders the *same* subtree, so if the
cause is still there it will throw again — fix the cause, then reset.

## What it catches

Errors thrown **while rendering** the subtree — in `render()`, in `@create`, or in a
`@compute` a render read.

It does **not** catch:

- **Event handlers.** A click that throws isn't part of a render — use `try/catch`.
- **Async work.** A rejected promise settles outside the render — catch it and put
  the failure in state.
- **Errors after the page updates.** An `@updated` or a subscription's `connect` that throws is reported, not caught
  here.

## For loading failures

[`AsyncLoad`](/composition/lazy) has its own `errorFallback` that plays the same role
— a failure UI with a way to retry — so a failed *load* and a failed *render* are
handled alike. (Its fields are named for a load: `{ error, retry, attempt }` rather
than `{ message, err, reset }`.)

## Next

- [Lazy loading](/composition/lazy) — loading a component only when it is needed.
