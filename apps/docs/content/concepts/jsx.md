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

**An event handler is `on` plus the event's own name.** The browser's event is called
`click`, so the prop is `onclick`:

```tsx
<button onclick={this.save}>Save</button>
```

Nothing is translated, so there is nothing to learn: `oninput`, `onsubmit`,
`onkeydown`, `onpointermove`, `onmouseenter`. Whatever you would hand to
`addEventListener`, put `on` in front of it. A camelCased `onMouseEnter` is refused,
and the error names the spelling to use. See [events](/concepts/events) for what you
can pass, how `this` stays bound, and how to reach a custom event whose name has a dash
in it.

**Two attributes sidestep JavaScript's reserved words.** `class` and `for` are
keywords in JavaScript, so JSX borrows the DOM property names instead — `className`
and `htmlFor`:

```tsx
<label className="field" htmlFor="email">Email</label>
```

Everything else — `id`, `href`, `disabled`, `value`, `placeholder`, `aria-*`,
`data-*` — is written exactly as in HTML. That includes the hyphenated ones:
`http-equiv` and `accept-charset` are written with their hyphens, not as
`httpEquiv` and `acceptCharset`.

Those two are the exception list in full. An attribute name is given to
`setAttribute` as it stands, so a name spelled any other way arrives in the
document as something no browser reads — it renders, it does nothing, and there
is nothing on the page to see. The types refuse the ones people reach for, with
the right spelling written into the error:

| written | what it should be |
|---|---|
| `httpEquiv` | `http-equiv` |
| `acceptCharset` | `accept-charset` |
| `defaultValue` | `value` — the attribute **is** the initial value |
| `defaultChecked` | `checked` |
| `innerHTML`, `textContent` | the element's children |

There is no controlled/uncontrolled pair here, which is why `defaultValue` has
nothing to mean: a render decides `value` like it decides any other attribute.

### A `false` takes an attribute away

`false` means the attribute should not be there, which is the only way to turn
`disabled` off — a boolean attribute is on whenever it is present, whatever it
says, so removing it is what says "off".

That applies to `data-*` too, and it is usually what you want:

```tsx
<div data-open={this.isOpen} />
```

```css
[data-open] .panel { display: block }
```

The flag is there or it is not. If you need the WORD `false` in the document —
a `[data-x="false"]` rule, or something reading `dataset.x` and expecting a
string either way — write it as one:

```tsx
<div data-x={String(this.ready)} />
```

`aria-*` is the exception: those are enumerated strings rather than flags, and
`aria-expanded="false"` means something an absent attribute does not. A `false`
on one of them is written rather than obeyed.

**An image and a frame have to be named.** `<img>`, `<area>` and `<iframe>` are
the two things on a page with nothing inside them to work them out from, so the
name is the content rather than a nicety — and the types ask for one:

```tsx
<img src="/chart.png" alt="Revenue, rising through Q3" />
<img src="/divider.png" alt="" />        // decoration: a decision, not an omission
<iframe src="/map" title="Office location" />
```

Any of `alt`, `aria-label`, `aria-labelledby` or `title` satisfies it — the same
four [`ramonda-check`](/reference/check) accepts, so the type and the rule never
disagree about a line. `alt=""` counts, because saying "skip me" is an answer.

Two consequences worth knowing, and both come from the same place — the type
asks for proof, not for an attempt.

`<img {...props} />` needs a `props` whose **type** carries one of the four. An
untyped bag is refused, since nothing about it says a name is in there.

And a name that might be `undefined` is refused too: an attribute given
`undefined` is not written at all, so `alt={caption}` where `caption` is
`string | undefined` leaves the image with no `alt` whatever. Decide instead:

```tsx
<img src="/photo.jpg" alt={caption ?? ""} />
```

`ramonda-check` is quiet on both of those lines, and that is not the two of them
disagreeing. A rule may never report a maybe — a spreading element is handed to
no rule at all, and an expression is not something it can evaluate. The type can
see both, so it asks the stronger question. Permissive where nothing can be
known, strict where something can.

**SVG keeps its real names.** Inside SVG the names are written exactly as SVG defines
them — `stroke-width` with a dash, `viewBox` in camelCase — because what you write is
the attribute the element actually has:

```tsx
<svg viewBox="0 0 24 24">
  <path d="…" stroke-width="2" />
</svg>
```

> **Written JSX before?** `className` and `htmlFor` will feel familiar. Two habits to
> drop, and they are the same habit: names here are the real ones. Event props are
> lowercase — `onclick`, `onmouseenter`, not `onMouseEnter` — and SVG attributes stay
> literal, so `stroke-width` is `stroke-width`, not `strokeWidth`.

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
  return list(this.rows, (item) => <Row item={item} />);
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
