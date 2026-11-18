---
"@ramonda/check": minor
---

`cached-read-of-a-plain-field` follows a cached reader further, along a closed list of paths: a method it calls or
hands to a call, a getter's own body, a function the project declares, and a props callback named rather than written
inline (`this.use(Hook, makeProps)`, `this.use(Hook, this.build)`). What a getter returns, a field holding a function
and a library's function are not followed. It also reports a `let` or `var` declared outside the class and written
inside a function, and counts a lazy first value (`??=`, `||=`, `if (!x) x = …`) as a write like any other: a value
made once belongs in a module constant or a `@compute`. `row-reads-a-plain-field` now sees a field written through a
pattern, and no longer counts a static field, a write in a static member, or a write through the `this` of a nested
`function` — each of those `this` is the class's or the function's own. The new rule `method-written-over` reports an
assignment to one of a component's or hook's own methods.
