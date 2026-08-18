---
"@ramonda/core": patch
"@ramonda/devtools": patch
---

A cast that names one property, and the three places `any` was only ever looseness.

Counted first, over every published package's `src` with tests, comments and string literals
excluded: **126 uses of `any`, 7 of them `as any`**. After this pass, **111 and zero** — every
remaining one is a type annotation with a reason, and the reasons are now written beside them.

What went:

- **`State.get()` and the effect's mutation set** cast `this` to `any` to reach `State<any>`. Both
  were vestigial: `this` is a `State<T>` and `State<T>` is assignable to `State<any>`. Two casts
  deleted, nothing else changed.
- **The props proxy** read `rawProps as any` twice. It is `Record<symbol, unknown>` for the symbol
  branch and `Record<string, unknown>` for the string one — the cast names the shape being indexed
  rather than opening the object.
- **`@state`'s registration** wrote `this as any` to reach the framework's own `STATE_KEYS` symbol. It
  is `{ [STATE_KEYS]?: Set<string> }`, so the cast covers the one property it writes.
- **`createRuntime(that: any)`** has exactly one call site, and it passes a component. It is
  `BaseComponent<any>`.
- **`filterVirtualChild(rawChild: any)`** takes whatever JSX produced, which is `unknown` — the
  function's whole job is to narrow it. The number-and-friends branch returns `String(rawChild)`
  instead of reassigning the parameter.
- **The devtools panel's three listeners** were `(e: any)`. `WindowEventMap` is augmented with the
  three channels core speaks on, so `e.detail` is typed at each one and the payloads are named in a
  single place. `DevLogPayload.data` and core's log entry are `unknown`: both are printed or rendered
  as JSON, never read into.
- **`Object.entries(...).forEach(([key, val]: any) => …)`** annotated the pattern, so both halves
  were `any`. Removing the annotation types both from `_listeners`.

What stays, each measured rather than assumed:

- **A decorator's `value: (...args: any[]) => any`.** `unknown[]` type-checks across this entire
  repository — and would refuse the first user who wrote `@updated after(n: number)`, with TS1241,
  because a parameter is contravariant. Nothing here declares a parameter on such a method, which is
  why the repo-wide check is a false green. The note is in `decorators.ts` so the next pass does not
  repeat the experiment.
- **`setNextOnenhancedNode`'s `value: any`.** It branches on what the attribute is — a `ref`, a
  listener, a string, a boolean — and hands each to a DOM API with its own type. `unknown` is 11
  narrowing casts, measured, which moves the looseness rather than removing it. Deleting it means
  making a vnode carry a discriminated attribute value, which is a redesign.
- **`Record<string, any>` on JSX attributes** carries the whole surface a host element accepts.

Behaviour is unchanged, and the one line that could have changed it is covered: breaking
`filterVirtualChild`'s coercion branch on purpose fails **98 of core's 1107 tests**.
