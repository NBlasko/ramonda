---
"@ramonda/check": patch
---

Four more from a second review, all in the code the first review's fixes added.

**`globals.ts` had one answer where the right one is asymmetric**, and `dom-writes` — a fifth rule
asking the same question — had already argued the other half. A prefix is not a form a local
plausibly shadows: nobody writes `const document = …` and then reaches for `.body.classList`, and
requiring `window` and `document` to resolve to nothing makes a rule depend on the run having no
lib, which is a silent trap for a project that declares the global itself. So `globalThis`, `window`
and `document` count by name; `self` and `global` have to prove themselves, because `self` really is
routinely a local. All five rules read one answer now, `dom-writes` included.

**`packageIsCore` cached on a directory path, which never invalidates** — unlike `row-callback.ts`'s
`WeakMap`, which hangs on a `SourceFile` and dies with the program. Measured before removing it:
`apps/docs` 1.26 s with the cache and 1.28 s without, `packages/core` 0.68 s and 0.71 s. Inside the
noise, because it is reached only where the specifier chain has already failed. Global mutable state
with a staleness hazard and no measured benefit is worth less than nothing.

**A `__DEV__` guard written as an expression was read as no guard at all.** `__DEV__ &&
window.addEventListener(…)` and `__DEV__ ? … : …` are the same claim as `if (__DEV__)`, and
`packages/core` writes the `&&` form thirteen times. So `listener-added-by-hand` reported dev-only
code for being spelled the other way — this repository's standing lesson, that a fix for one
spelling is not a fix for the other, arriving on schedule.

**`declaredInsideCore` took `declarations[0]`.** A name with an overload set or a merged namespace
has more than one, and which comes first is not something to build an identity on. Every declaration
is asked now.
