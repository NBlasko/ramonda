---
"@ramonda/core": patch
---

The documentation now says why there is no post-commit `@watchProp`.

It is the obvious sugar — "run this after the commit, but only when this prop changed" — so its absence
was reading as a gap. It is a decision, and `/concepts/lifecycle` now gives the three reasons: it would
be strictly narrower than `@updated` (props only, not a hook's state, not context, not any other cause
of a commit — which the DOM cases usually are); its state write could not fold into the render the way
the in-build one does, so the framework would have to start comparing your props for you; and the `if`
it would replace answers "is the DOM already how I want it", which only the author knows.

`@watchProp` before the render, `@updated` after it, one field comparison for the guard. No new API.
