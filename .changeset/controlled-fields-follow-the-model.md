---
"@ramonda/core": minor
---

A controlled `Select` or `TextArea` shows the model's value again as soon as its handler returns

After every `change` and `input`, `Select` and `TextArea` call the app's own `onchange` / `oninput`
and then render again, so the field shows whatever the model now holds. A handler that leaves the
value where it was — a refused pick, a rejected keystroke — puts it back at once. Before, the field
kept showing the user's input until the page rendered again for another reason: a `Select` was put
right by its parent's next render, which handed it new children every time, and a `TextArea` never
was.

A `Select` or `TextArea` with a `value` and no handler is now one the page cannot change, since the
model never moves. The handler is still called as a listener is, with the element as `this`.
