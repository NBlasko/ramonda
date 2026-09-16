---
"@ramonda/css": patch
---

A second fault on the same line is reported again.

Where a rule of ours already speaks for a fault, the compiler's word about the same one is dropped
so an author reads one message rather than two. That drop was keyed on the LINE — and a line holds
as many declarations as you care to write, so anything else on it went too. Measured,
`padding-left: $.size.control.mdd; color: $.size.control.md;` reported the typo and silently lost
the kind mismatch beside it, which nothing else catches: a kind is a type, not a rule the build
runs. In an editor, a one-line component lost an ordinary `const n: number = "no"` the same way.

The unit is the declaration now, in both the checker and the editor.
