---
"@ramonda/css": minor
---

Two rules that read a style prop's type, not just its block.

**`style-prop-never-used`** — a component takes a block through a prop and never puts it on an
element. Nothing fails today: the caller's styles simply do not arrive, which is the quiet way a
component and its caller come apart. A prop is used when it is spread into a block, put on a `css`
attribute, or handed to another prop that also takes a block, and it is followed through a local on
the way.

**`style-prop-overridden`** — `...{props.css}; padding: 8px` where the prop's own type says a caller
may send `padding-left`. The shorthand clears the longhand exactly as CSS says, so the merge is not
wrong; what is wrong is a component that promised a property and then took it back. Two fixes and
both are right: move the spread below, or take the property out of the prop's type. Only a narrowed
prop is asked about — a bare `CssBlock` promised nothing in particular.

Both need a `ts.Program`, so they run in `ramonda-css check` and not in the bundler adapters, which
transform and never see a type. Both are turned off by id in `ramonda.css.ts` like every other rule.

Also: **a block that may not be there can now be spread.** `...{props.css}` where `css` is optional
was refused by the type while the runtime had always skipped an absent block, and an optional prop
is the ordinary shape for a style a caller may send. `...{cond && block}` works for the same reason.
