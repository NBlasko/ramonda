---
title: The host element
description: A component is one element on the page — this is how you choose which element that is.
section: Core concepts
order: 25
---

# The host element

You have seen that a component becomes exactly one element on the page. That element
is the component's **host**, and everything the component renders lives inside it.
This page is about choosing which element it is.

## The default: an invisible wrapper

If you don't say otherwise, a component's host is a special element that takes up no
space of its own:

```html
<ramonda-host style="display: contents"></ramonda-host>
```

`display: contents` means it has no box — its children lay out exactly as if the
wrapper weren't there. So adding a component never pushes a stray row into your grid
or an item into your flex row. Most of the time you can forget it exists.

(One thing to know: it removes the *box*, not the *node*. A selector like
`.card > p` won't reach a `<p>` sitting inside a component, because there is still a
node between them. If you write selectors across a component boundary, give the
component a real host — next.)

## `@Host` — a real element

To make a component *be* a particular element, add `@Host`:

```tsx
@Host("nav")
export class Menu extends Component {
  render() {
    return <ul>…</ul>;
  }
}
```

Now `<Menu />` is a `<nav>` with the `<ul>` inside it.

To put attributes on that element, pass a **callback** as the second argument. It
runs on every render, so the host can react to your state:

```tsx
@Host("nav", (self: Menu) => ({ className: self.open ? "open" : "" }))
export class Menu extends Component {}
```

## Letting the caller choose the element

The tag can be a function of the props, so whoever uses the component picks:

```tsx
@Host((props: CardProps) => props.as ?? "div")
export class Card extends Component<CardProps> {}
```

```tsx
<Card as="section" />
```

```demo:HostTag
```

Keep that function simple and based only on the props — Ramonda may call it more than
once while it decides whether an existing element can be reused.

## Some parents need a specific child

A few HTML elements only accept certain children, and the browser quietly rearranges
or deletes anything else — the invisible default host included. Inside those, give
your component the element the parent expects:

| inside | give your component |
|---|---|
| `<table>` | `@Host("tbody")` |
| `<tbody>` | `@Host("tr")` |
| `<tr>` | `@Host("td")` |
| `<select>` | `@Host("option")` |
| `<svg>` | `@Host("g")` |

Two things keep this painless: `render()` may return an array, so one `@Host("tr")`
can hold many `<td>`s; and a `<table>` may contain several `<tbody>`s. In
development, a host a parent would break is reported as `RMD010`, with the tag to
use instead.

## `@Host` is inherited

A subclass keeps its parent's host and can override it:

```tsx
@Host("td")
class Cell extends Component {}

@Host("th")
class HeaderCell extends Cell {}
```

## Next

- [Components](/concepts/components) — the one-tag rule this rests on.
- [Examples](/examples) — every feature as a running component.
