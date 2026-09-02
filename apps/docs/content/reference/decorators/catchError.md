---
title: catchError
description: Declares the method that handles an error thrown anywhere below this component — the primitive ErrorBoundary is built on.
section: Reference
order: 122
---

# `@catchError`

An error thrown while a component renders travels **up the component tree** until something catches
it. `@catchError` declares the method that does the catching, and everything below that component is
covered.

## The situation it is for

A dashboard with a chart in it. The chart reads data that is sometimes malformed, and when it throws
the error travels up — past the chart, past whatever wraps it — until something catches it. If
nothing does, the whole dashboard goes.

```tsx
class Chart extends Component<{ points: number[] }> {
  render() {
    if (this.props.points.length === 0) throw new Error("No points to draw");
    return <p>{this.props.points.length} points</p>;
  }
}

class Panel extends Component<{ points: number[] }> {
  @state failed = "";

  @catchError
  whenSomethingBreaks(e: unknown) {
    this.failed = e instanceof Error ? e.message : String(e);
  }

  render() {
    return (
      <section>
        <h2>Revenue</h2>
        {this.failed ? <p>Chart unavailable: {this.failed}</p> : <Chart points={this.props.points} />}
      </section>
    );
  }
}
```

The heading stays, the rest of the page stays, and the one panel that broke says so. Writing to
`@state` from the handler is what puts the message on screen — the handler runs, then the component
renders again with `failed` set.

[`<ErrorBoundary>`](/composition/error-boundaries) is built on this. Reach for the component when
you want a fallback around a subtree; reach for the decorator when the component that should recover
is the one you are already writing.

## The parameter is `unknown`, and that is not caution

Anything can be thrown. `throw "gone"` and a promise rejecting with a string are both reachable, so
`(e as Error).message` is `undefined` and the panel shows an empty failure. Measured on a query
rejecting with a string, a number and a plain object: three of the four rendered nothing at all.

```tsx
e instanceof Error ? e.message : String(e)
```

## Declining an error

**Return `false`** and the error carries on to the next ancestor that has a handler. Anything else —
`undefined` included, which is what a method with no `return` gives — means handled.

That is how `ErrorBoundary` steps aside when the thing that threw was its own fallback: a boundary
that caught its own failure would swallow the very error it exists to show.

## Which handler runs

The walk takes the **first ancestor that has one**, so nesting works the way it does in the DOM: an
inner boundary catches what happens inside it, and only what it declines reaches the outer one.

**Two on one class is a mistake** and is reported as [`RMD032`](/reference/diagnostics/rmd032):
there is one answer to *who handles this*, and a second declaration can only shadow the first.

**A subclass declaring its own is not that.** It is an override, it is the ordinary way to
specialise a boundary, and it is silent. The handler is dispatched by name, so overriding the
method **without re-decorating** works too — and `super.whenSomethingBreaks(e)` does what the base
did, which is the reason this is a method decorator rather than a class one.

## Why it is a decorator and not a name

Catching used to work by name: any component with a method called `catchError` became an error
boundary. That is a framework reserving a name on every class, and it changes behaviour silently the
day somebody writes a method that happens to be called that.

**The method is yours to name.** `whenSomethingBreaks`, `recover`, `report` — the decorator says
which one it is.

## What it refuses

**A hook.** An error travels up the *component* tree and a hook is not on it, so a handler declared
there would sit and never be called. The types refuse it — a hook does not satisfy the constraint —
and it throws in every build for a project without them.

**Anything but a method.** It handles by calling something; a field has nothing to call.

## What it does not catch

An error thrown **outside a render** — in a `setTimeout`, in a promise nobody awaited, in an event
handler — never enters the tree walk, because there is no component on the stack to walk up from.
Handle those where they happen.

## Next

- [Error boundaries](/composition/error-boundaries) — the component built on this, and its fallback.
- [`RMD032`](/reference/diagnostics/rmd032) — more than one handler on one class.
- [Lifecycle](/concepts/lifecycle) — where a component's other callbacks run.
