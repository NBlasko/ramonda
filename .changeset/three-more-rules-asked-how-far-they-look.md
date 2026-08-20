---
"@ramonda/check": patch
---

Three more rules asked how far they look, on the axis that has found something every time: what a
`this.helper()` hop, and a helper in another file, cost the claim.

**`server-env-in-shared-code` had a FALSE POSITIVE, on the shape its own advice recommends.** Its
stance for a member nothing in the class references is "it may be called from anywhere, so it is not
excused on silence" — which is true of a PUBLIC member and not of a `protected` one, whose callers
can only be this class chain. And the chain is walked upward, never down. So a base holding
`protected fromDb() { return process.env.DATABASE_URL }`, called only from a server-only lifecycle
in the subclass, was reported as browser code — as an ERROR. Measured with a plant.

An unreferenced `private` or `protected` member is excused now. A `private` one with no reference in
its own class cannot be called by anything at all; a `protected` one can only be called by a
subclass this cannot see. Everything referenced is judged exactly as before — a private helper a
`render()` calls is still reported.

The miss this leaves is written into the rule rather than left to be discovered: a subclass calling
such a helper from `render()` is a real fault and is reported by nothing.

**`unwatched-fields` had the same false positive, and it is an ERROR too.** A hook belongs to the
INSTANCE, so a base's `this.use(Field, …)` subscribes the subclass exactly as its own would — and
reading one class body made a subclass that reads what its base watches a reported fault on working
code. The watch is looked for up the chain now.

**`unkeyable-memoized-argument` missed every call to an inherited handler.** A `@memoized` on
a base is the subclass's handler, on the same instance and with the same cache, so
`this.pick({ id })` down there THROWS `RMD047` at runtime exactly as it would up here — and nothing
said so. Calls are matched against the chain now, while the DECLARATION half stays where it is
written, so a base's unkeyable parameter is reported once rather than again for every subclass.

**`browser-url` and `dom-writes` reach a helper on the class and stop at the file boundary**, and
that is now a decision on the record instead of an accident. Both were measured: a read or a write
one `this.method()` away IS found; a utility in another file is not. Following the import would name
a component that did not write the line, in a file it does not own, once per caller — these reports
carry no path to say otherwise, which is exactly why the two rules that DO follow imports have one.
