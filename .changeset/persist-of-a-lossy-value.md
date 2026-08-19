---
"@ramonda/check": minor
---

A new rule: `persist-of-a-lossy-value`.

`@persist` has one job — put a field into the hydration blob, which is JSON. So a `Map`, a `Set`, a
`Date`, a `RegExp`, a function or a class instance makes the decorator do nothing, and it does
nothing **quietly**: none of them throws on the way out. `JSON.stringify(new Map())` is `{}`, and a
`Date` arrives as a string. The client starts with a value of the wrong shape and fails later,
somewhere else, on a method the value no longer has.

The report says what the value BECOMES rather than "not serializable", because the cases fail
differently: an empty object fails at the first method call, while a `Date` that became a string
fails only where somebody asks it the time.

The static half of `RMD033`, which says the same thing once a value actually crosses. `@state`
holding the same value is **not** reported: reactive state only reaches the blob on a server render,
so a browser-only project may hold anything in it. `@persist` creates no signal and has no other
effect, so the decorator itself is the claim.
