---
"@ramonda/check": minor
---

New rule: `half-built-keyboard-path` — the rule an existing one asked for by name

`click-with-no-keyboard-path` reports a click on a plain element with no `role`, no `tabIndex` and
no key handler. It goes quiet the moment any of those appears, and its own comment says why: *"A
half-built path is somebody's decision to build it by hand, and picking at it is a different rule
from this one."* That rule did not exist, so the half-built path was reported by nobody.

`<div role="button" onclick={save}>` is somebody taking on work the platform does for a `<button>`.
The role is the announcement — a screen reader now says "button" — and the rest has to be written
out. Two ways it stops short, and they fail differently:

- **No `tabIndex`.** A reader is told there is a button and cannot get to it at all. The mouse
  works, so it looks finished to whoever wrote it.
- **`tabIndex` and no key handler.** Tab lands on it, the reader presses Enter, and nothing happens
  — worse than not reaching it, because they were told it is a button and given every reason to
  believe they used it correctly.

The two rules enter on the same condition — a pointer handler on an element that is not natively
interactive — and split on whether the author had started. `INTERACTIVE` and the two event readers
are shared between them, because two rules dividing one territory have to agree about where the
territory begins.

A pointer handler is required, which is what makes the report certain rather than a guess about
intent: `<div role="button">` with nothing wired to it may have its handler attached through a ref.
Silent on a role it cannot read, on a role chain, on a role that is not a widget, on a real control
inside, and on a spread that may be carrying either missing half.

`ACTIVATED_BY_THE_USER` in `aria.ts` leans SHORT, which is the opposite of `ROLES` beside it: a rule
reads this one to report an element whose role IS in it, so an entry too many reports markup that
never needed a keyboard path.

**Two silences the review measured into it**, because the first version reported the W3C's own
authoring patterns. A `listbox` takes the arrow keys and its options carry a roving `tabIndex={-1}`;
a `toolbar` and a `tablist` do the same. Read as elements on their own, every child there is a click
with no key handler — the canonical three produced FOUR reports against markup that is the
recommendation.

So the roles OWNED by a composite parent — `option`, `tab`, `menuitem`, `treeitem`, `radio` and the
two menu checkbox roles — came out of the table, leaving the ones a user operates on their own. And
a key handler on any ancestor in the render counts as the keys being handled, which is what covers a
`role="button"` inside a toolbar.
