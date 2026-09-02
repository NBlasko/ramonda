---
title: memoized
description: Caches a method's answer per argument — including the handler identity a row needs.
section: Reference
order: 127
---

# `@memoized`

Caches a method's answer, **keyed by its arguments**. Called again with the same arguments, it hands
back the same value — the same object, not an equal one.

## The situation it is for

A list where every row has a delete button. The row needs a handler that knows **which** row it is,
so the obvious spelling builds one in the markup:

```tsx expect-report:function-built-in-the-markup
class Row extends Component<{ id: string; onRemove: () => void }> {
  render() {
    return <li><button onclick={this.props.onRemove}>{this.props.id}</button></li>;
  }
}

class Table extends Component<{ rows: string[] }> {
  drop(id: string) {}

  render() {
    return list(this.props.rows, (id) => (
      <Row key={id} id={id} onRemove={() => this.drop(id)} />
    ));
  }
}
```

That arrow is a **new function every render**, so every row is handed a changed prop and every row
re-renders — a thousand rows redrawn because one of them was deleted. `ramonda-check` reports it as
[`function-built-in-the-markup`](/rules/function-built-in-the-markup).

`@memoized` gives each id its own handler, and the same one back next time:

```tsx
class Table extends Component<{ rows: string[] }> {
  @memoized
  remover(id: string) {
    return () => this.drop(id);
  }

  drop(id: string) {}

  render() {
    return list(this.props.rows, (id) => (
      <Row key={id} id={id} onRemove={this.remover(id)} />
    ));
  }
}
```

Now a row's `onRemove` only changes when its id does, which is never.

## It caches a value, not only a handler

Nothing about it is specific to functions. Any expensive answer keyed by an argument works the same
way — see [Caching](/concepts/caching) for which of the two decorators a case wants.

## What it refuses

**Anything but a method.** It keys a cache by arguments, and a field has none.

## What it costs

**One cache per instance**, keyed by the arguments, and it is never evicted while the component
lives. A method called with unbounded arguments grows a map that only the component's removal
clears.

**The arguments have to be keyable.** They are compared as a key, so two structurally identical
objects are two entries — and an argument that cannot be a stable key is reported as
[`unkeyable-memoized-argument`](/rules/unkeyable-memoized-argument).

**It is not free where nothing was wrong.** A method returning a scalar of its arguments is cheaper
to call than to look up. Reach for it where the *identity* matters — a handler, an object handed to
a child — or where the work is real.

## Next

- [Caching](/concepts/caching) — `@compute` or `@memoized`, and the question that decides.
- [`@compute`](/reference/decorators/compute) — no arguments, one cached value.
