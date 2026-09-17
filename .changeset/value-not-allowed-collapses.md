---
"@ramonda/css": patch
---

One mistake, one report, for a value a project refuses twice over.

`width: 2rem` under a closed `values` list and a `units` list drew two findings — *`2rem` is not one
of the values this project allows* and *`rem` is a unit this project does not use* — for one word
and one fix.

The rules a project switches on overlap by construction, which is why the check already collapses
them to the outermost question: which property, then how many values, then where the value comes
from, then how it is spelt. `value-not-allowed` was not in that list, and by the same reading it
belongs between the last two: the unit is a detail of a value that is not on the list, and reading
the unit first sends you to `2px`, which the list still refuses.
