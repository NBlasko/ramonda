---
title: JSX
description: The HTML-like syntax you write in a component — values, attributes, children, refs.
section: Core concepts
order: 31
---

# JSX

JSX is the HTML-like syntax you write inside a component to describe what to show.
You have been using it already:

```tsx
render() {
  return <p className="lead">Hello</p>;
}
```

It looks like HTML, but it lives in your code — so you can mix in values and logic.
(Your bundler turns it into function calls behind the scenes;
[installation](/guide/installation) sets that up.)

## Putting values in

Curly braces `{ }` drop a value into the markup — text, a number, whatever an
expression produces:

```tsx
<p>Hello {name}, you have {count} messages</p>
```

## Attributes

Attributes use the **DOM's own names**. Most match HTML; a couple differ because the
HTML name is a reserved word in JavaScript — `className` (not `class`), `htmlFor`
(not `for`).

```tsx
<label className="field" htmlFor="email">Email</label>
```

**SVG is worth reading twice.** Inside SVG, Ramonda writes attribute names exactly as
SVG defines them — `stroke-width` with a dash, `viewBox` in camelCase — because the
JSX is meant to mirror the real element:

```tsx
<svg viewBox="0 0 24 24">
  <path d="…" stroke-width="2" />
</svg>
```

## Children

What sits between the tags: text, other elements, components, and `null` for nothing.

```tsx
<section>
  <h1>{title}</h1>
  {subtitle ? <p>{subtitle}</p> : null}
</section>
```

For a **list** built from an array, use `list()` rather than `.map()` — it keeps
track of which item is which, so items hold their place when the list changes:

```tsx
render() {
  return list({ each: this.rows, as: Row });
}
```

See [rendering lists](/lists).

## `ref` — reaching the real element

Sometimes you need the actual element on the page — to focus an input, measure it,
play a video. `ref` hands it to you:

```demo:RefFocus
```

On a plain tag, `ref` gives you that element. On a component, it gives you the
component's one element (its host).

## Why no raw HTML strings (optional)

Some frameworks let you drop a raw HTML string straight into the page. Ramonda does
not: markup pasted as a string is invisible to the framework — it can't take part in
a render, can't hold a component, can't be hydrated. If you have HTML from elsewhere,
parse it into a tree and render that. (That is exactly how this docs site shows its
markdown.)

## Next

- [State](/concepts/state) — the data a component remembers.
