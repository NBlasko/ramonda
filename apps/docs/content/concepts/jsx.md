---
title: JSX
description: The HTML-like syntax you write in a component — values, attributes, children, refs.
section: Core concepts
order: 21
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

## Names: it reads like HTML, but the names are JSX's

JSX *looks* like HTML, but what you type is not HTML text — it compiles to function
calls, and the names are keys on those calls. That is why a few of them differ from
the HTML you may know. Three rules cover almost everything.

**Events are camelCase, with an `on` prefix.** The browser's event is called `click`;
in plain HTML the attribute is `onclick`, all lowercase. In JSX you pass a handler as
`onClick` — capital `C`:

```tsx
<button onClick={this.save}>Save</button>
```

The shape is always `on` + the event name with each word capitalised: `onInput`,
`onSubmit`, `onKeyDown`, `onPointerMove`. Lowercase `onclick` will **not** work — it
is a different key, and nothing listens to it. See [events](/concepts/events) for
what you can pass and how `this` stays bound.

**Two attributes sidestep JavaScript's reserved words.** `class` and `for` are
keywords in JavaScript, so JSX borrows the DOM property names instead — `className`
and `htmlFor`:

```tsx
<label className="field" htmlFor="email">Email</label>
```

Everything else — `id`, `href`, `disabled`, `value`, `placeholder`, `aria-*`,
`data-*` — is written exactly as in HTML.

**SVG keeps its real names.** Inside SVG the names are written exactly as SVG defines
them — `stroke-width` with a dash, `viewBox` in camelCase — because the JSX mirrors
the real element one to one:

```tsx
<svg viewBox="0 0 24 24">
  <path d="…" stroke-width="2" />
</svg>
```

> **Written JSX before?** The `onClick` and `className` / `htmlFor` conventions will
> feel familiar. The one habit to drop is SVG: Ramonda leaves SVG attribute names
> literal instead of camelCasing them, so `stroke-width` stays `stroke-width`, not
> `strokeWidth`.

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
  return list(this.rows, Row);
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
