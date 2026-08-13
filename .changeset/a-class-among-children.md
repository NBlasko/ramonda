---
"@ramonda/check": minor
---

A component named among JSX children is reported.

`{Named}` where `<Named />` was meant. Measured in core before the rule was written: it renders
**nothing**, and no diagnostic is emitted — a class is a function, so `RMD037`, the check for an
object among children that is not markup, never sees it. The page simply comes up without the
component, and nothing anywhere says a word.

Nothing legitimate has this shape. Handing a component over is an attribute, and `<Slot view={Named}
/>` is a binding rather than a child — the fixture pins that difference.

`{cond && Named}` and `{cond ? Named : null}` are the same mistake behind a branch, and are reported
too.
