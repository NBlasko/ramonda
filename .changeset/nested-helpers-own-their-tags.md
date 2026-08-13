---
"@ramonda/check": minor
---

A helper written inside another helper owns its own tags.

A helper's body was walked whole, nested functions included, so a tag written in an inner function
became an edge from the inner helper AND from the outer one — from the same line, with the outer one
never writing it. And a helper calling a helper produced no edge at all, because a call was read only
inside a component's body; the false render edge is what accidentally covered for the missing call
edge.

Reachability agreed while the outer function did call the inner one. Define the inner one and never
call it and the outer still claimed to render its tags, which a rule about components nobody renders
would read as live.

Found by an agent's scratch fixture during a review that was stopped before it reported.
