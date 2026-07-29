---
"@ramonda/devtools": minor
---

The panel stops flickering, says "Props" where it meant props, and gets out of its own way.

**The Query tab rewrote its whole list twice a second, idle or not.** `innerHTML` on every poll
destroys and rebuilds every row, which resets hover, text selection and focus and repaints — the
flicker you could see in the DOM inspector. It now compares a SHAPE (keys, statuses, observer
counts, previews, errors) and rewrites only when that moves; the "updated Ns ago" text, which
changes every tick and would otherwise defeat any comparison, is refreshed in place by hash. The
poll is 500ms rather than 250ms, since nothing faster is readable and every tick polls every live
cache.

**A hook's inputs are labelled `Props`.** They were called options once, the framework renamed
them, and the panel kept saying the old word to everyone inspecting a hook.

**State and props are legible.** Bigger type, room to breathe, and a long value scrolls inside its
own box instead of ending in an ellipsis — the value that got truncated is reliably the one you
needed to read. (Both the type size and the value rendering moved again later in this release; see
the entries below.)

**A leaf has no disclosure triangle.** A component with no state, no props, no hooks and no
children has nothing to open, and a triangle that reveals emptiness is a claim the reader has to
click to disprove.

**A toolbar for finding things:** expand all, collapse all, hide state & props, hide hooks. The
filters are a class on the container rather than a re-render, so they are instant and every
`<details>` stays exactly as the reader left it.
