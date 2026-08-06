---
"@ramonda/core": patch
---

The props gate behaves under `extends` like every other decorated method

Two things did not, and both were silent.

Overriding the decorated method without re-decorating ran the BASE's body: the decorator kept the
function it was handed at decoration time instead of looking the method up on the instance, so the
subclass's version was dead code that read as live. `@create` and `@watchProp` register
`this[name].bind(this)` and honour the override; one decorator out of three failing at the pattern the
docs recommend is worse than any of them failing at it. The gate now dispatches by name too.

And declaring the gate on both levels — the ordinary way to override a rule — reported "more than one
… remove the others", which is advice to delete the line doing the work. The subclass already won
correctly; only the report was wrong. It is now raised for two declarations in the SAME class, told
apart by the prototype that owns each one.
