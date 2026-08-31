---
"@ramonda/core": patch
---

The context object's second publisher is now held to the protocol, not just described by it

`createContext` writes a per-key signal channel onto a component's context object. The `Head` hook
writes the node its descendants hang under — same object, same mechanism, a key of its own. The
protocol that makes that safe is stated in one place already, and both sides obey it.

Nothing enforced it. `Head` does not go through `createContext`, no test put the two of them on one
component, and two invariants it depends on were invisible from any call site: the object is
prototype-chained per component, and a publisher writes an OWN property so descendants inherit the
slot and siblings do not.

Both are now pinned. Making the per-component object unchained fails the first test; making `Head`
publish onto the parent's object instead of its own fails the second — and that second one only bites
on a TEARDOWN, which is why the test drops a branch and checks that its descendant's tags go with it
while its sibling's stay. Asserting merely that every tag exists passed with the fault in place.

A shared read/write helper was considered and not written: the four accesses are two reads and two
writes of `object[key]`, so wrapping them adds an indirection over what the type's own note calls the
design — "the read is where the shape is named" — and would still not fail if the object stopped being
prototype-chained. The test does.
