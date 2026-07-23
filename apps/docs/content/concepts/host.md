---
title: The host element
description: Every component is exactly one element. @Host says which, and the default takes part in no layout.
section: Core concepts
order: 35
---

# The host element

Every component is exactly one element. That element is its **host**, and everything the
component renders lives inside it.

## The default host

Without `@Host`, a component's element is:

```html
<ramonda-host style="display: contents"></ramonda-host>
```

Two properties make that cheap enough to ignore.

**`display: contents` generates no box.** The host takes part in no layout — its children lay
out exactly as if it were not there. Adding a component does not add a row to your grid or a
flex item to your row.

**It is a custom element**, so it is inert and cannot collide with a real tag. A `<div>` would
have closed an open `<p>`; this does not.

### The one cost, stated plainly

The host removes the *box*, not the *node*. CSS selectors match the tree.

```css
.card > p { }        /* no longer matches a <p> inside a component */
.card p:first-child  /* may now match something that is not first */
```

If you are writing structural selectors across a component boundary, give the component a real
host with `@Host` and select that.

## `@Host` — a real element

```tsx
@Host("nav")
export class Menu extends Component {
  render() {
    return <ul>…</ul>;
  }
}
```

`<Menu />` now renders a `<nav>` containing the `<ul>`.

Host attributes come from a second argument — a **callback**, so it is reactive and re-runs on
every render:

```tsx
@Host("nav", (self: Menu) => ({ className: self.open ? "open" : "" }))
export class Menu extends Component { }
```

A plain object would be frozen at class-definition time and could never react, so it is
rejected.

## The tag from props

The tag may be a callback receiving props, which lets the **caller** choose the element:

```tsx
@Host((props: CardProps) => props.as ?? "div")
export class Card extends Component<CardProps> { }
```

```tsx
<Card as="section" />
```

```demo:HostTag
```

It must be **pure**. The diff calls it while deciding whether an existing element can be reused,
so it runs more than once and may depend on nothing but the props it is handed.

### One instance's host never changes

The host element *is* the component: swapping it later would destroy that element and everything
attached to it — its listeners, whatever a ref points at, its position in the document.

So a prop change that would resolve to a different tag does not mutate the host. It fails to
match in the diff, and a **fresh component is built in its place** — the same thing that happens
when a `key` changes. The old one is destroyed properly; the new one starts from scratch.

That is worth knowing before you drive `as` from state that changes often.

## Where the default host is not allowed

Some parents reject unknown children, and the failure is not a rendering glitch — the browser's
own parser rearranges or deletes nodes:

| parent | what happens to `<ramonda-host>` |
|---|---|
| `<table>` `<thead>` `<tbody>` `<tfoot>` `<tr>` | foster-parented **out, empty** — the component is split in two |
| `<select>` `<optgroup>` | **deleted outright**, options kept |
| `<svg>` | wrong namespace; the two sides disagree about what the node is |
| `<ul>` `<ol>` `<dl>` `<p>` | survives untouched |

Development reports this as `RMD010`, naming the parent and suggesting a tag.

**The guidance is "become the element the parent expects":**

| inside | use |
|---|---|
| `<table>` | `@Host("tbody")` |
| `<tbody>` | `@Host("tr")` |
| `<tr>` | `@Host("td")` |
| `<select>` | `@Host("option")` |
| `<svg>` | `@Host("g")` |

Two facts stop that being as awkward as it sounds: **`render()` may return an array**, so one
`@Host("tr")` can hold many `<td>`s without a component per cell; and a `<table>` may legally
contain several `<tbody>` elements.

`<ul>` is deliberately **not** on the list. Its content model says "only `<li>`", so it looks
like it belongs — but foster-parenting is a *table* rule, and a `<ramonda-host>` inside a `<ul>`
survives intact. Invalid-per-spec is your business; silently destroyed is the framework's.

## Inheritance

`@Host` is inherited, and a subclass can override it:

```tsx
@Host("td")
class Cell extends Component { }

@Host("th")
class HeaderCell extends Cell { }
```

## Next

- [Components](/concepts/components) — why one tag is one element.
- [Examples](/guide/examples) — every feature as a running component.
