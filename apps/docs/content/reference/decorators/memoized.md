---
title: memoized
description: Caches a method's answer per argument — including the handler identity a row needs.
section: Reference
order: 127
---

# `@memoized`

Caches a method's answer, **keyed by its arguments**. Called again with the same arguments, it hands
back the same value — the same object, not an equal one.

```tsx
class Table extends Component<{ rows: string[] }> {
  @memoized
  remove(id: string) {
    return () => this.drop(id);
  }

  drop(id: string) {}

  render() {
    return list(this.props.rows, (id) => <Row key={id} onRemove={this.remove(id)} />);
  }
}
```

That example is the case it is most often reached for: **a handler per row**. Written inline, the
arrow is a new function on every render, so every row's prop has changed and every row re-renders.
Memoised, each row gets the same function back for as long as its id is the same.

`ramonda-check` reports the inline version as
[`function-built-in-the-markup`](/rules/function-built-in-the-markup).

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
