---
"@ramonda/core": minor
---

RMD020 and RMD022 report a `Date`, a `Map`, a `Set` or a class instance built inside a render — and an
inline function inside an object prop is named as the handler it is.

**A gap that two files documented as covered.** `classify` asked `isPlainObject`, which is
`Object.prototype`-or-null and nothing else, so any value with a prototype fell through to "this
difference says nothing about how it was built". Measured, `new Date()` was reported in no position at
all — not as a component prop, not as a DOM attribute, not as a child — while `debug/purityGuard.ts`
listed it under "what covers the clock then" as *"RMD020, every time (a fresh object has a fresh
identity)"*, and `renderStability.ts` said the same. Being a fresh object only helps if the comparison
looks at it.

There is a new `instance` verdict for it, separate from `object` because the contents genuinely are not
read: `valueEqual` walks own enumerable keys and a `Map`'s entries are not those. So it says the object
is FRESH rather than claiming it matched. Two different prototypes from two calls in one tick stays
non-determinism — a render that builds its own `class` is exactly that.

**And a report that named the wrong fault.** `cfg={{ fn: () => 1 }}` was reported as *"produced a
different value … so the value does not come from state"*, advising a hunt for a `new Date()` or a
`Math.random()` in an app containing neither — the two bags differ only in a closure's identity. A plain
object prop whose contents are not equal is now descended into, so each key answers for itself and the
report says `cfg.fn`, "the source is the same". A differing *set* of keys is not a rebuild and stays
non-determinism. `children` one level down is an ordinary key, not a tree.

Nothing that was quiet becomes loud by accident: a stable field, a `@compute` or a module constant passes
`Object.is` long before any of this, so only a value constructed during the render can reach it.
