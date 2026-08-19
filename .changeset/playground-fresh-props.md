---
"@ramonda/core": patch
---

Pinned a guarantee a demo now leans on: a slot object handed over from a `@compute` still arrives,
and still follows the state it is built from.

`fresh-object-in-props` reports `slots={{ body: … }}` — a literal rebuilt every render, which the
child can never be skipped over — and the fix it advises is a `@compute`. That is only advice worth
giving if the cached object still updates, so both halves are now asserted rather than assumed.
