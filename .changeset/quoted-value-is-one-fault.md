---
"@ramonda/css": patch
---

A quoted value is one fault, and the type says why both spellings are there.

`z-index: "1"` under `values: [0, 1, 10]` gave two findings, and the second was worse than
redundant — *takes only 0, 1, 10 … and this is `"1"`* names a value that IS in the list. The fault
is the quoting, which `string-not-allowed` already says. `value-not-allowed` leaves it alone now.

**And the string spellings in the type are explained where they are met.** Configuring
`values: [0, 1, 10]` and hovering showed `"0" | "1" | "10"` beside the numbers, which reads as a
widening and is not one: a block is CSS, so `z-index: 1` reaches the type as the string `"1"`. The
doc comment says so, rather than leaving it to be worked out from the union.

The module's header count is counted rather than derived from line shapes — the longer comment made
it read `207.5 properties`.
