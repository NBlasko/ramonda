---
title: onWindow
description: Listen to a window event for as long as the component is on the page — attached at mount, removed when it leaves.
section: Reference
order: 130
---

# `@onWindow`

Listens to an event on `window` for as long as the component is on the page.

## The situation it is for

A layout that shows a sidebar on a wide window and a menu button on a narrow one. The decision
depends on something no parent can pass down, and it changes while the page is open:

```tsx
class Layout extends Component<{ children?: RamondaNode }> {
  @state wide = true;

  @mounted
  first() {
    this.measure();
  }

  @onWindow("resize")
  measure() {
    this.wide = window.innerWidth > 900;
  }

  render() {
    return (
      <div>
        {this.wide ? <nav>Sections</nav> : <button type="button">Menu</button>}
        {this.props.children}
      </div>
    );
  }
}
```

Two decorators on one method, and both are needed: `resize` only fires when the window **changes**,
so `@mounted` is what gets the first answer.

The listener is added at mount and removed when the component is destroyed. **There is nothing to
clean up** — which is the reason to reach for this rather than calling `addEventListener` yourself,
where the cleanup is a second thing to remember and a leak when it is forgotten.

## The event name is the DOM's

`"resize"`, `"scroll"`, `"keydown"` — the name `addEventListener` takes, not the JSX attribute. Two
spellings are refused **by the types**, each with the sentence that says what to write:

```tsx expect-error
@onWindow("onresize")   // ✗ write the event's own name, not the JSX attribute
@onWindow("MouseDown")  // ✗ an event name is lower case, and addEventListener is case-sensitive
```

The second is not the compiler being fussy: `addEventListener` compares names exactly, so
`"MouseDown"` attaches a listener that can never fire and nothing at runtime would say so.

A name that is not one of `window`'s known events is still allowed — a custom event is a real thing
to listen for.

## Listener options

The second argument is `addEventListener`'s own:

```tsx
@onWindow("scroll", { passive: true })
onScroll() {}
```

## What it refuses

**Anything but a method.**

**An empty or non-string event name**, which throws where it is written rather than at mount.

## What it costs, and when not to reach for it

Every instance of the component attaches its own listener. Fifty rows each listening for `resize` is
fifty listeners — put it on the one component that owns the answer and pass it down.

**It is browser-only.** A server render never mounts, so nothing is attached there.

For an event on **this component's own element**, use the JSX attribute — `onclick={this.save}` —
which needs no decorator at all. `@onWindow` is for the events that happen somewhere your markup
does not reach.

## Next

- [Events](/concepts/events) — handlers on your own elements, and how they are named.
- [`@onDocument`](/reference/decorators/onDocument) — the same, on `document`.
- [Your own decorators](/hooks/own-decorators) — for a subscription that is not a DOM event.
