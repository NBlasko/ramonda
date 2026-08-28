---
"@ramonda/core": patch
---

Test only: the nested shapes served and then adopted

Queue item 6, the half of this path where the faults were — five of the eight findings in round four
of the range review were here. A shape that renders correctly twice can still be wrong across the
boundary, because hydration does not re-render the server's markup: it walks it, and a client
expecting a different tree adopts the wrong nodes or reports a divergence on markup that was right.

Five shapes, all already correct: context read through a displaced slot, a list inside a slot, an
`AsyncLoad` the server waited for and served loaded, a boundary that caught on both sides, and one
that was fine on the server and threw on the CLIENT — caught during adoption, which a boundary that
only worked on a fresh render would have let escape after the page was already shown.

Each asserts that a node the server built is still the node on the page, not only that the text
matches. With adoption disabled, two of the five stayed green on text alone.
