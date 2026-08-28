---
"@ramonda/check": patch
---

`late-request-read` sees a request taken onto a field

`ctx = requestContext()` written as a FIELD is the same take one scope out. The initializer runs at
construction — on the server, inside the synchronous section `renderToString` has not yet cleared —
so the take itself is correct, and every read of it below an `await` is late. Nothing reported one,
while the identical `const ctx = requestContext()` a line lower was.

It is the shape somebody writes precisely to stop calling `requestContext()` over and over, which
is what made the silence expensive: the tidier the code, the less the rule saw. The report says
which door was used, because the take is on a line the reader is not looking at.

Bounded exactly as the local is — only an initializer that IS the call, nothing followed and
nothing inferred.

The rest of the boundary was re-tested rather than trusted, since the rule defends its own
narrowness as a division of labour with the runtime's RMD053 while arguing two paragraphs earlier
that RMD053 is not a sufficient backstop. It came back sound: a `try`, a `finally` and a loop body
are all correctly below the await; an `await` inside a nested function correctly does not yield the
body around it; and a value taken before the await — destructured, or read into a local — is
correctly in hand afterwards and is not reported.
