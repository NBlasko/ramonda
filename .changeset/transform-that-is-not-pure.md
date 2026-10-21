---
"@ramonda/check": minor
---

`transform-that-is-not-pure`: a field's `transform` is a pure function the check can read

The function is read, and so is every function it calls or hands on that is written in the project —
in another file, or returned once by a factory at the top of a module (`export const max20 =
maxLength(20)`). Reported: a `transform` that reads `this`, the page (`document`, `fetch`, the clock,
chance) or a `let`; one that writes anything it did not make, including what its parameters hold, or
waits; one that calls a function whose body cannot be read; one whose own body cannot be read — a prop,
or a package's declaration; one made by a call in the markup, a new function on every render; and one
on a field with no `value` (`checked`), which has no model to decide against.
