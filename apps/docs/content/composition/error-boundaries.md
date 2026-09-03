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
class Page extends Component {
  @state data: unknown = null;

  // A bound method rather than an arrow in the markup: written inline it is a new function every
  // render, which `RMD020` reports and `function-built-in-the-markup` catches before it runs.
  broke({ message, reset }: ErrorBoundaryFallbackProps) {
    return (
      <p className="error">
        Something broke: {message} <button onclick={reset}>try again</button>
      </p>
    );
  }

  render() {
    return (
      <ErrorBoundary fallback={this.broke}>
        <ReportView data={this.data} />
      </ErrorBoundary>
    );
  }
}
```

```demo:ErrorBoundaryDemo
```

Break the `Report` and everything *outside* the boundary keeps working. So put
boundaries around the parts of a page that can fail on their own — a widget, a panel,
a route — rather than one at the very top.

## The fallback is a function — `ErrorBoundaryFallbackProps`

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

Anything thrown on a path **the framework is running**: `render()`, `@created`,
a `@compute` a render read, and the commit phase that follows — `@mounted`,
`@updated`, a subscription's `connect`. All of those go through the framework, so
the error can be walked up to the nearest boundary.

It does **not** catch:

- **Event handlers.** The browser calls a listener directly, so a throw inside one
  never passes through the framework and no boundary can see it. Use `try/catch`,
  or put the failure in state.
- **Async work.** A rejected promise settles on its own time, with no render around
  it — catch it and put the failure in state.

The line is not "render versus the rest". It is whether the framework was the one
calling.

## For loading failures

[`AsyncLoad`](/composition/lazy) has its own `errorFallback` that plays the same role
— a failure UI with a way to retry — so a failed *load* and a failed *render* are
handled alike. (Its fields are named for a load: `{ error, retry, attempt }` rather
than `{ message, err, reset }`.)

## Next

- [Lazy loading](/composition/lazy) — loading a component only when it is needed.
