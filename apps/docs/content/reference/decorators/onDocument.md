---
title: onDocument
description: Listen to a document event for as long as the component is on the page — attached at mount, removed when it leaves.
section: Reference
order: 129
---

# `@onDocument`

Listens to an event on `document` for as long as the component is on the page. Everything true of
[`@onWindow`](/reference/decorators/onWindow) is true here — the same lifetime, the same refusals,
the same options argument — and only the target differs.

```tsx
class Dialog extends Component<{ onClose: () => void }> {
  @onDocument("keydown")
  escape(e: KeyboardEvent) {
    if (e.key === "Escape") this.props.onClose();
  }
}
```

## Which of the two to reach for

`document` is where **events that bubble** end up, so this is the one for a keystroke or a click
anywhere on the page — a shortcut, a menu that closes when you click outside it.

`window` is where events that are about the **viewport or the page itself** are dispatched:
`resize`, `scroll`, `hashchange`, `beforeunload`. Those do not bubble to `document` at all, so the
choice is not a preference.

## What it refuses

The same three as `@onWindow`: anything but a method, an empty or non-string event name, and — by
the types — `"onkeydown"` or `"KeyDown"`, each refused with the sentence that says what to write.

## What it costs

One listener per instance, attached at mount. A shortcut belongs on the component that owns the
action, not on every row that might be affected by it.

**Browser-only**, like every listener.

## Next

- [Events](/concepts/events) — handlers on your own elements.
- [`@onWindow`](/reference/decorators/onWindow) — the viewport's events.
