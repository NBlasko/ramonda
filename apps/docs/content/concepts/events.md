---
title: Events
description: React to clicks and keys — handlers as props, or decorators for window, document, and the host.
section: Core concepts
order: 24
---

# Events

Events are how a component reacts to what the user does — a click, typing, submitting
a form.

## On an element you render

Pass a handler as a prop. Event props are **camelCase with an `on` prefix** —
`onClick`, `onInput`, `onSubmit` — a [JSX naming convention](/concepts/jsx), not the
lowercase HTML `onclick`. The browser's event is `click`; the prop you write is
`onClick`.

```tsx
render() {
  return <button onClick={this.increment}>+1</button>;
}
```

`this.increment` is a method on your component. **Ramonda ties your methods to the
component for you**, so handing one to `onClick` just works — `this` still means the
component inside it. No constructor, no arrow-function fields, no `.bind(this)`. (A
method whose name starts with `_` is left unbound, if you ever want to opt out.)

If your handler needs the event, annotate its parameter with the matching DOM event
type. `onInput` hands you a plain `Event` — read `event.target` for the value;
`onClick` a `PointerEvent` (a `MouseEvent` with pointer details, so `clientX` and
`button` are there too):

```tsx
onInput(event: Event) {
  this.text = (event.target as HTMLInputElement).value;
}
```

An inline arrow — `onClick={(e) => …}` — types `e` for you, and that is the only
thing it does better. It also builds a new function on every render, so the listener
is removed and re-added on the element every time, and a development build reports it
(`RMD020`). Annotate the method instead; when a handler has to be built per item,
[`@memoizedHandler`](#a-handler-per-item) caches it by its arguments.

## On window, document, or the component's own element

Some events don't come from an element you render — the window resizing, a key
pressed anywhere on the page. Decorators handle those:

```tsx
@onWindow("resize")
onResize(event: UIEvent) {}

@onDocument("keydown")
onKey(event: KeyboardEvent) {}

@onElement("click")
onClick(event: MouseEvent) {}
```

Each attaches when the component appears and removes itself when the component goes
away — no cleanup to write, and no way to leave one dangling.

```demo:WindowSize
```

```demo:KeyboardShortcut
```

### The event is typed from its name

Name the event and the handler's parameter is typed to match: `"keydown"` gives a
`KeyboardEvent`, `"click"` a `MouseEvent`, with no cast. A custom event name the
platform doesn't know is typed as the general `Event`.

### `@onElement` and the default element

`@onElement` listens on the component's own [host element](/concepts/host). By
default that host takes up no space of its own, so events that need a physical box —
hover, pointer position — won't reach it, though clicks that bubble up from children
still do. If you need those, give the component a real element with `@Host("div")`.
Development warns you when this bites.

`@onWindow` and `@onDocument` also work on a [Hook](/hooks); `@onElement`
does not, because a hook has no element of its own.

## A handler per item

A row usually needs a handler that knows *which* row it is, and the obvious way to
write that is a closure per item — which is a new function on every render, re-attached
to every button, every time. `@memoizedHandler` caches the function **by its
arguments, per instance**, so asking twice gives the same function back:

```tsx
@memoizedHandler
remove(name: string) {
  return () => {
    this.items = this.items.filter((item) => item !== name);
  };
}

// in render:
<button onClick={this.remove(name)}>remove</button>
```

The decorated method **returns** the handler rather than being one — that is what
gives the cache something to key. Arguments must be strings, numbers or booleans; the
key is built from them, and an object has no stable form to build one out of. When the
value you have is an object, pass the index the list's mapper already hands you, or an
id from the item.

Entries whose arguments were not asked for during a render are dropped, so the cache
follows the list instead of growing with every value ever seen.

```demo:MemoHandlers
```

Press the identity button: the same arguments give back the same function, which is
what keeps the listener from being re-attached — and what stops
[RMD020](/reference/diagnostics) reporting the row.

## Which to use

| the target is… | use |
|---|---|
| an element in your `render()` | a prop: `onClick={this.handle}` |
| `window` or `document` | `@onWindow` / `@onDocument` |
| the component's own element | `@onElement` |

## Next

- [Timers](/concepts/timers) — the same idea, for time.
- [The decorator table](/reference/decorators) — `@onElement` is components-only; the other two are not.
