---
title: Components
description: The class, render(), and the rule that one JSX tag is exactly one element.
section: Core concepts
order: 30
---

# Components

A component is a class extending `Component`, with a `render()` that returns JSX.

```tsx
export class Card extends Component {
  render() {
    return <div className="card">…</div>;
  }
}
```

## One tag, one element

**Every JSX tag produces exactly one element.** An intrinsic tag like `<div>` is a `<div>`. A
component tag like `<Card />` is one element too — the component's *host*.

This is the rule the rest of the framework is arranged around, and it buys one thing: **you can
read the DOM off the JSX.** A tree of tags and the tree of nodes it produces have the same
shape. Nothing collapses, nothing expands, nothing disappears.

Two things follow, and both are refusals.

**There are no fragments.** Nothing that renders as "several elements at this position, or
none" exists as a tag.

**There are no function components.** A function in tag position would be a tag that is not an
element. TypeScript rejects it, and if it reaches the runtime anyway Ramonda reports `RMD011`
and points at what to use instead.

## What to use instead of a fragment

Two questions get asked here, and they have different answers.

**"I need several elements at this position."** `render()` may return an array. The elements
become children of the component's host.

```tsx
render() {
  return [<td>{this.props.name}</td>, <td>{this.props.score}</td>];
}
```

**"I need state and lifecycle but no element of my own."** That is a [Hook](/concepts/hooks), not
a component. A hook has `@state`, `@create`, `@destroy` and effects, can provide context, and
adds no node at all.

If the wrapper element is simply not in your way — and it usually is not, because the default
host takes part in no layout — write an ordinary component and stop thinking about it. See
[the host element](/concepts/host).

## Conditionals

`null` renders nothing.

```tsx
render() {
  return (
    <div>
      {this.loading ? <Spinner /> : null}
      <p>Always here.</p>
    </div>
  );
}
```

`&&` works too, with the usual caveat that a falsy non-boolean renders itself — `{count && …}`
prints `0`. Prefer an explicit ternary.

## Composition is inheritance

The unit of reuse is the class, and classes extend each other. A component that is *almost*
another component subclasses it — overriding `render()`, adding state, adding methods, calling
`super`.

```tsx
@Host("th")
export class HeaderCell extends Cell {
  render() {
    return <strong>{super.render()}</strong>;
  }
}
```

This is why the fragment question comes up less than you would expect. In a framework whose
unit is a function, reuse means nesting, nesting costs an element, and a fragment hides it.
Classes do not nest to be reused, so no wrapper appears.

`@Host` is inherited and can be overridden. Inherited `@state`, hooks and lifecycle methods keep
working; `@create` runs base-first, then subclass.

## Next

- [JSX](/concepts/jsx) — children, arrays, keys, and what `h` does.
- [The host element](/concepts/host) — which element a component *is*.
