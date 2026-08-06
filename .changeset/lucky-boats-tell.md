---
"@ramonda/core": patch
---

RMD005 says what it covers, and the docs stop claiming it covers objects

`concepts/state.md` told readers that "changing an array or object in place is caught and reported as
`RMD005`". Objects are not caught. `this.user.name = "x"` is the same silent no-op the array report
exists for — the signal never fires, the render keeps showing the old value, and nothing says a word.

An array can be watched because the mutation goes through a method — `push`, `splice`, `sort` — and
a property assignment on an object has no such seam without wrapping every object the state hands
out. So the asymmetry is a consequence of the shape of the thing, not an oversight, and what it costs
a reader is the belief that the check is the boundary of what goes wrong.

The rule is the boundary: replace, do not change in place. That is now what all three places say — the
concept page, the diagnostic's own fix text, and the reference section — and
`MutationGuardScope.test.tsx` pins both halves, so the day an object guard is added the test fails and
sends whoever added it to the sentences that have to change with it.
