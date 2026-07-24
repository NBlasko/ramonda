---
title: Components
description: What a component is, how you use one, and the single rule the framework rests on.
section: Core concepts
order: 30
---

# Components

A component is a small class that draws one piece of the page and knows how to react
to what happens on it. You write one by extending `Component` and giving it a
`render()`.

```tsx
export class Card extends Component {
  render() {
    return <div className="card">…</div>;
  }
}
```

You build a whole app out of components: small ones — a button, an avatar — combined
into bigger ones — a card, a page.

## Using a component

Write its name as a tag:

```tsx
<Card />
```

A component can take input from whoever uses it (see [props](/concepts/props)) and
keep its own memory (see [state](/concepts/state)).

## One tag, one element

Ramonda has a single rule that everything else rests on: **every tag in your JSX
becomes exactly one element on the page.** A `<div>` is one `<div>`. Your own
`<Card />` is one element too.

Because of that, the shape of what you write is the shape of what appears — nothing
quietly splits into several elements or vanishes. Once you can picture the page from
the code, a lot of guesswork goes away.

## Showing one thing or another

Return `null` to draw nothing. A `? :` (ternary) picks between two things to show.

```tsx
render() {
  return (
    <div>
      {this.loading ? <Spinner /> : <p>Ready.</p>}
      <p>Always here.</p>
    </div>
  );
}
```

Prefer a ternary to `&&` for showing and hiding: `{count && <p>…</p>}` prints a
stray `0` when `count` is `0`, because a leftover number draws itself.

## Returning several elements

Sometimes a component needs to place several elements at its spot rather than wrap
them in a container. `render()` may return an array:

```tsx
@Host("tr")
export class Row extends Component {
  render() {
    return [<td>{this.props.name}</td>, <td>{this.props.score}</td>];
  }
}
```

Here one `Row` is a table row — `<tr>`, its [host element](/concepts/host) — holding
several cells, with no extra component per cell.

## Reusing a component

Because a component is a class, one that is *almost* another can **extend** it: keep
what it had, change what differs.

```tsx
@Host("th")
export class HeaderCell extends Cell {
  render() {
    return <strong>{super.render()}</strong>;
  }
}
```

Inherited state, hooks and lifecycle keep working. More in
[inheritance](/composition/inheritance).

## Why one tag, one element (optional)

Some frameworks let one tag stand for several elements at once (a *fragment*), or let
a plain function be a tag (a *function component*). Ramonda allows neither, on
purpose — both break the promise that a tag is one element, and that promise is what
lets you read the page off the code.

The two cases people reach for them still have answers. Need state and lifecycle but
no element of your own? That is a [Hook](/hooks). Bothered by a wrapper
element? The default one takes part in no layout, so it usually isn't in the way —
see [the host element](/concepts/host). Using a function as a tag is refused:
TypeScript rejects it, and at runtime it is reported as `RMD011`.

## Next

- [JSX](/concepts/jsx) — the HTML-like syntax, up close.
- [The host element](/concepts/host) — which element a component *is*.
