---
"@ramonda/check": minor
---

A new rule: `state-mutated-in-place`, the static half of `RMD005` and `RMD048`.

A signal fires when it is **assigned** a new value, not when the value it already holds changes
inside. So `this.items.push(row)` and `this.user.name = "x"` leave the signal holding the object it
was holding a moment ago: the setter never runs, nothing is scheduled, and the page keeps showing
what it showed before. The data is right and the screen is wrong — which reads as the framework
being broken rather than as a mistake in the code, and is the commonest first impression anybody has
of a signal.

It mirrors `debug/mutationGuard.ts` boundary for boundary rather than drawing its own line, so the
two can never disagree about somebody's code: **only plain objects and arrays** (the guard wraps
nothing else, because a `Date` or a class instance needs its real receiver), and **only the nine
mutating array methods** (`map`, `filter`, `slice` and a spread return a new value, which is the fix
rather than the fault).

Reported anywhere in the class, not only from a render — a handler is where the fault usually lives,
and it is the one place a render-scoped rule would never look.
