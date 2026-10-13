---
"@ramonda/core": patch
---

A list whose rows are not objects is tested

`ListIdentityAudit.test.tsx` covers twenty-six arrangements of `list()` across a refetch and every
row in all of them is an object. `helpers/itemIdentity.ts` has a branch for the other case at every
step it takes — `item === null || typeof item !== "object"` appears four times, and `signature` has
a `p` prefix for a primitive — and none was exercised. `list(["a", "b", "c"], …)` is the first list
anybody writes.

Measured before asserted, and two answers were not the expected ones. A reversed list of strings
keeps every component and the same DOM node, so a value pairs by being itself. Three copies of one
string rebuild all three, because equal strings cannot be told apart and pairing them by position
would put one row's state on another. Both follow from the same rule.

Also pinned: an append builds exactly one row, dropping one of several equal items destroys exactly
one, `null` and a change of value type are a change rather than a crash, a primitive beside an
object upsets neither, and no primitive row is ever reported as unidentifiable — that diagnostic is
for a bag of fields every sibling shares, and a list of strings must not be nagged about keys.
