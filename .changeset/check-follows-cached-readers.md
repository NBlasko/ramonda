---
"@ramonda/check": minor
---

`cached-read-of-a-plain-field` follows a cached reader wherever it reads: through a getter, a function the project
declares, and a props callback named rather than written inline (`this.use(Hook, makeProps)`, `this.use(Hook,
this.build)`). It also reports a `let` or `var` declared outside the class and written inside a function. The new
rule `method-written-over` reports an assignment to one of a component's or hook's own methods.
