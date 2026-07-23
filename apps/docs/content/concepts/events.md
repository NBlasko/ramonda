---
title: Events
description: Handlers as props, or as decorators on window, document and the host element.
section: Core concepts
order: 38
---

# Events

## As props

The ordinary case. `onClick`, `onInput`, `onSubmit` — the DOM's own names.

```tsx
render() {
  return <button onClick={this.increment}>+1</button>;
}
```

**Methods are bound for you.** Passing `this.increment` does not lose `this`, so there is no
constructor and no arrow-function field. That matters beyond convenience: a decorator cannot be
applied to an arrow field, so binding methods is what keeps `@memoizedHandler` and friends usable
on handlers.

A method whose name starts with `_` is left unbound, by convention, if you want to opt out.

## As decorators

For listeners that are not on an element you render.

```tsx
@onWindow("resize")
onResize(event: UIEvent) { }

@onDocument("keydown")
onKey(event: KeyboardEvent) { }

@onElement("click")
onClick(event: MouseEvent) { }
```

Each attaches on mount and removes on unmount. There is no cleanup to write and no way to leak
one.

```demo:WindowSize
```

```demo:KeyboardShortcut
```

### The parameter is typed from the name

`"keydown"` gives you a `KeyboardEvent`, `"click"` a `MouseEvent` — with no cast. Each decorator
uses the DOM's own event map for the target it listens on, so the name and the parameter cannot
disagree.

A name the map does not know — a custom event — is accepted and typed as `Event`, which is all
the platform can promise about it.

### `@onElement` and the default host

`@onElement` listens on the component's **host** element. With the default
`<ramonda-host style="display: contents">` that host generates no box, so it is never the direct
target of a pointer event.

Events that bubble from children still reach it, so `click` usually works. Anything that does not
bubble, or that depends on the element having a box — hover, pointer position, focus on the host
itself — will not. Development warns about this.

If you need those, give the component a real host: `@Host("div")`.

### `@onWindow` and `@onDocument` work on hooks

They only need a runtime, not an element, so a [Hook](/concepts/hooks) can own a global listener.
`@onElement` cannot — a hook has no element.

## Which to use

| | |
|---|---|
| the element is in your `render()` | a prop: `onClick={this.handle}` |
| the target is `window` or `document` | `@onWindow` / `@onDocument` |
| the target is the component's own host | `@onElement` |

## Next

- [Timers](/concepts/timers) — the same mechanism, for time.
