---
"@ramonda/check": minor
---

Two rules that follow what a render REACHES, not what it is written to contain.

`state-written-while-rendering` — a write to `@state` or `@persist` from anything `render()` or a
`@compute` can reach. `clock-read-while-rendering` — `Date.now()`, `new Date()`, `Math.random()` or
`performance.now()` reached the same way.

The walk is the rule. A fault is almost never in the body of `render()`: it is in a helper on the
class, in a utility imported from another file, or in the third branch of a chain of conditionals.
The report names the path — `render → decorate → stampedLabel` — which is the useful half, because a
clock three files away is baffling on its own and obvious once the path is written down.

A nested function is walked only when it is INVOKED during the render — an argument to `list(each,
…)` or `.map(…)`, or a function called on the spot. Anything returned, assigned or handed to an
attribute runs later, and its body is exactly where writing state is correct. That distinction is
not decoration: the first version walked into everything that was not written directly as a JSX
attribute, and it reported five places in this repository, every one of them `@memoizedHandler` —
a first-class idiom of the framework.

`new Date(value)` is not reported; parsing a timestamp is deterministic. A write to a field that is
not state is not reported. A `@mounted` is not reported, because a render does not reach it.

Both are warnings, and both are quiet across this repository.
