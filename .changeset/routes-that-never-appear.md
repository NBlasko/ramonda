---
"@ramonda/check": minor
---

A route table whose views can never appear is reported.

Two ways to get there, and a reader fixes them differently: nothing hands the table to a
`<RouteOutlet>` this build can see, or an outlet does and no root reaches that outlet. Either way
every page in the table renders nothing — and each page on its own looks perfectly well formed,
which is why nothing else says a word. A whole section of a site can be gone without one error
anywhere.

The second rule read from the graph rather than from the source, and it needed nothing new: the walk
already knows which outlets it arrived at.

The pages themselves are not reported as dead code — a page is exported, and an exported declaration
is a way in. The fault belongs to the table and is reported once, where the table is written.

A build with no root is not judged, for the same reason a library is not judged for dead
declarations. Across the four apps here the rule is silent.
