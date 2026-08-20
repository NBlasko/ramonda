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

Pass a handler as a prop. An event prop is **`on` plus the event's own name**, exactly
as the browser spells it — `onclick`, `oninput`, `onmouseenter`, `onfocusin`. There is
no second vocabulary to learn and nothing is translated: whatever you would pass to
`addEventListener`, put `on` in front of it.

That is why it is lowercase. `onMouseEnter` is a convention from elsewhere, and this
framework refuses it rather than quietly accepting a name the DOM does not have — the
error names the spelling to use.

```tsx
render() {
  return <button onclick={this.increment}>+1</button>;
}
```

`this.increment` is a method on your component. **Ramonda ties your methods to the
component for you**, so handing one to `onclick` just works — `this` still means the
component inside it. No constructor, no arrow-function fields, no `.bind(this)`. (A
method whose name starts with `_` is left unbound, if you ever want to opt out.)

If your handler needs the event, annotate its parameter with the matching DOM event
type — or leave it out, because the type is already known: every handler's parameter is
typed from the DOM's own event map. `oninput` hands you a plain `Event` — read
`event.target` for the value; `onclick` a `PointerEvent` (a `MouseEvent` with pointer details, so `clientX` and
`button` are there too):

```tsx
onInput(event: Event) {
  this.text = (event.target as HTMLInputElement).value;
}
```

An inline arrow — `onclick={(e) => …}` — types `e` for you, and that is the only
thing it does better. It also builds a new function on every render, so the listener
is removed and re-added on the element every time, and a development build reports it
(`RMD020`). Annotate the method instead; when a handler has to be built per item,
[`@memoized`](#a-handler-or-a-value-per-item) caches it by its arguments.

### An event whose name `on…` cannot spell

`on` plus the name covers every standard event, because all of them are a single
lowercase word. A **custom** event usually is not — a web component dispatches
`my-event`, with a dash — and `onmy-event` reads as a typo while `on-my-event` would
listen for `-my-event`, which nothing dispatches.

So write it after a colon and it is taken exactly as it stands:

```tsx
<x-thing on:my-event={this.handle} />
```

The handler receives a plain `Event`; a custom event's `detail` is your own, so cast it
to the shape you dispatched.

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

## A handler, or a value, per item

A row usually needs a handler that knows *which* row it is, and the obvious way to
write that is a closure per item — which is a new function on every render, re-attached
to every button, every time. `@memoized` caches the function **by its
arguments, per instance**, so asking twice gives the same function back:

```tsx
@memoized
remove(name: string) {
  return () => {
    this.items = this.items.filter((item) => item !== name);
  };
}

// in render:
<button onclick={this.remove(name)}>remove</button>
```

The decorated method **returns** the handler rather than being one — that is what
gives the cache something to key. Arguments must be strings, numbers or booleans; the
key is built from them, and an object has no stable form to build one out of. When the
value you have is an object, pass the index the list's mapper already hands you, or an
id from the item.

Entries whose arguments were not asked for during a render are dropped, so the cache
follows the list instead of growing with every value ever seen.

**It caches a value as readily as a function**, and that is why it is not called
`@memoizedHandler` any more. A row that needs a stable object — a config bag, a query
key, props for a child — has the same problem and the same answer:

```tsx
@memoized
config(id: string) {
  return { id, href: `/rows/${id}` };
}

// in render:
<Row cfg={this.config(row.id)} />
```

Nothing else reaches this case. A `@compute` belongs to the **component**, not to the
row, so it cannot hold one value per item; a field and a module constant cannot either.
That is what `RMD020` and `RMD022` mean when they report an object rebuilt per row.

## What the cache is allowed to remember

The method runs **once per key** and never again, so anything it reads before returning the handler is
closed into that handler and would be frozen there:

```tsx
@memoized
remove(name: string) {
  const mode = this.mode;                  // read while BUILDING the handler
  return () => this.apply(mode, name);
}
```

That is watched. The reads the builder makes are tracked, and when one of them changes, **that entry is
dropped** — the next render builds the handler again, with the value the signal now holds. Only that
entry: a handler built for other arguments, which read nothing, keeps the very same function.

So the rule is short: **read state inside the returned handler when you can, and if you read it while
building, expect a new function when it changes** — which is right, because the handler now does
something different.

A builder that reads nothing is the common case and pays nothing at all: no reads are tracked, no entry
is ever dropped, and the handler is the same function for the life of the component. A **plain field**
(not `@state`) read while building is the one thing that cannot be watched, for the same reason it
cannot be watched anywhere — there is no signal to hear from.

```demo:MemoHandlers
```

Press the identity button: the same arguments give back the same function, which is
what keeps the listener from being re-attached — and what stops
[RMD020](/reference/diagnostics) reporting the row.

## Which to use

| the target is… | use |
|---|---|
| an element in your `render()` | a prop: `onclick={this.handle}` |
| `window` or `document` | `@onWindow` / `@onDocument` |
| the component's own element | `@onElement` |

## Next

- [Timers](/concepts/timers) — the same idea, for time.
- [The decorator table](/reference/decorators) — `@onElement` is components-only; the other two are not.
