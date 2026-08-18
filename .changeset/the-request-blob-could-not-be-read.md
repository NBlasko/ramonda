---
"@ramonda/core": minor
---

`RMD056` — the request blob could not be read.

`hydrateRoot` reads the values a page opted into from an attribute the server stamped on the root
element. When that string does not parse, nothing is restored: every `requestContext().get(key)` on
the client answers `undefined`, including keys that were exposed correctly. That was already the
behaviour and it is the right one — a page that renders with a value missing beats a page that does
not render, which is the same stance `RMD036` takes for the state blob.

**What was missing is the report.** Silence here is expensive, because two other diagnostics fire in
its place and both point away from the cause. Measured on a page whose blob was mangled after it was
served: `RMD025` says the key was not exposed — it was — and `RMD007` reports the render mismatch
that follows, whose advice is about clocks and random numbers. The page looks correct throughout,
because the server's markup is still on screen. A reader is sent to add `exposeToClient` to a key
that already has it, and then to hunt non-determinism that is not there.

`RMD056` is the one that says what actually happened. Its test asserts the other two beside it —
neither is a bug, each is right about what it can see, and this is the code that explains them.

A warning rather than an error, matching `RMD036`.
