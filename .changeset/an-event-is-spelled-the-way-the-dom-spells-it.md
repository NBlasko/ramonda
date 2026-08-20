---
"@ramonda/core": minor
"@ramonda/form": minor
"@ramonda/check": patch
"create-ramonda": patch
---

**Breaking: an event handler is now `on` plus the event's own name — `onclick`, not `onClick`.**

The old spelling was never the camelCase it looked like. Handlers were derived from the element's
`on…` PROPERTIES and renamed to `` `on${Capitalize<name>}` ``, and the DOM's event types are single
lowercase tokens — so what the types actually offered was `onMouseenter`, `onKeydown`,
`onDblclick`. The natural `onMouseEnter` was a hard error and the accepted spelling was one nobody
would guess. It survived unnoticed because every event this repository writes is ONE word, where
capitalising the first letter happens to give the right answer.

Handlers come from the DOM's event MAP now. Nothing is capitalised, so there is nothing to get
wrong, and the old spellings are refused with a message naming the one to use.

**Three things this fixes.**

- **Five standard events had no spelling at all.** `focusin`, `focusout`, `compositionstart`,
  `compositionupdate` and `compositionend` have no `on…` property, so the old mapping could not see
  them: `onFocusIn` was a type error and lowercase `onfocusin` fell through to `any`. They are
  ordinary — `focusin` is what you reach for BECAUSE `focus` does not bubble, and `composition*` is
  IME input. All five are typed now.
- **`on:` attaches a name verbatim**, for the events `on…` cannot spell — a custom event with a
  dash, which is what a web component dispatches by convention. `<x-thing on:my-event={…} />`.
  Before this, `on-my-event` typechecked and attached a listener for `-my-event`, an event nothing
  in the world dispatches. Measured: the handler never ran.
- **Every handler's parameter is typed from the event map**, so `onclick` hands you a
  `PointerEvent` and `oncompositionstart` a `CompositionEvent`, with no annotation.

**What to change.** Lowercase the event props on host elements: `onClick` → `onclick`,
`onSubmit` → `onsubmit`, `onInput` → `oninput`. A component's own props are untouched — an
`onSelect` you declared is yours and keeps its name. `@ramonda/form`'s `bind` follows the same
rule: `CommonBind.onInput` and `.onBlur` are now `oninput` and `onblur`, which matters only if you
read them off `bind` by hand rather than spreading it.

The compiler finds every one of them: a camelCased event name is refused, and the error carries the
spelling to write.

**`@ramonda/check`** kept up in two places, both of which would have gone quiet:
`client-only-request-read` recognised a handler by the CAPITAL after `on`, and
`click-with-no-keyboard-path` looked for `ondoubleclick`, which is not a DOM event and never
matched anything.
