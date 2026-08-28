---
"@ramonda/core": patch
---

A row keeps the reader in it when a list reorders

Moving a node means removing and re-inserting it, and a removed node is blurred — the platform, and
the same in plain JavaScript. Everything else about the row already survived: its node, the text
being typed, the caret, its own `@state`. Only focus did not, which is the one loss with no sign on
the page. The reader goes on typing into nothing.

It is restored by the reorder, because nothing else can: no render says which of its rows the
platform is about to pick up.

It costs one `document.activeElement` read per walk that actually moves something — a render whose
DOM already matches returns before reaching it — and one `focus()` only when the element really lost
it. Re-focusing something that never lost it would fire a second `focus` event for nothing.

This closes a decision the test suite had been holding open: `ListRowKeepsWhatTheUserTyped` asserted
the loss and said it would start failing the day somebody took the decision.
