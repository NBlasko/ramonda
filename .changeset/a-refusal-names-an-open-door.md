---
"@ramonda/css": patch
---

**Three refusals explained themselves with a mechanism that no longer exists**, and one of them sent
the author into the next error.

A hole in a declaration used to compile to a custom property on the element. Since a runtime value
is refused everywhere, it does not — but three messages still said it did.

`hole-out-of-place` was the one that cost something. It read *a custom property holds a value, so
write `property: {…}` and put the choice inside it*. Measured, all three spellings in one run:

| written | reported |
|---|---|
| `@@( {pick}; )` | `hole-out-of-place` — what the author wrote |
| `@@( color: {pick}; )` | `hole-not-allowed` — what the message told them to write |
| `@@( color: var({A}); )` | clean — what works |

It names the open door now: `@@property( … )` read as `var({name})` for a value from data, `match`
for a choice between a few.

`hole-in-a-named-block` said *a hole is a custom property on an ELEMENT*, which also implied a hole
would work outside a named site. Its own row in the rule table had the true reason all along —
*which have no element* — so the message a person reads disagreed with the table they look it up in.
It now gives the reason and something to do.

`glued-hole` opened with *a hole becomes one custom property*; the sentence that matters — text
written against a hole is not part of its value — is unchanged and now leads.
