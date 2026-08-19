---
"@ramonda/check": minor
---

A new rule: `click-with-no-keyboard-path`.

`<div onClick={…}>` works for a pointer and for nothing else. The element is not in the tab order, so
it cannot be focused; not being focusable, Enter and Space never reach it; and with no role a screen
reader announces it as text rather than as something to do. The control is simply not there for
anybody not using a pointer, and the page looks entirely correct.

Reported only when all of it is true at once: a non-interactive host element, a pointer-only handler
(`onClick`, `onMouseDown`, `onMouseUp`, `onDoubleClick`), no key handler, no `tabIndex`, no `role`,
nothing interactive inside it — and **content**.

Two exclusions, and the second was found by running the first version rather than by thinking about
it. A wrapper that widens an existing control's hit area ("click anywhere on the card") already has
a keyboard path one level in. And an **empty** element is a backdrop or an overlay rather than a
control: its click is a convenience beside Escape and a close button, and it announces nothing
because there is nothing to announce. Both reports the first version made against this repository's
own documentation site were exactly that, and both were correct markup.

The line drawn is structural rather than a guess at a class name: an element with content presents
itself as something to do, and this reports that a keyboard cannot do it.
