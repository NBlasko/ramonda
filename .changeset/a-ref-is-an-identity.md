---
"@ramonda/core": minor
"@ramonda/check": minor
---

A swapped `ref` is honoured at once, and building one in a render is reported

`<TextArea ref={cond ? a : b} />` did not hand the node over when `cond` flipped. The old ref kept
pointing at a live node and the new one stayed empty until something else happened to update that
field — measured, and found by reading the one unhit branch left in `base/TextArea.tsx`.

`helpers/arePropsBagsEqual.ts` ignored `ref`, for a reason that was true when it was written: a
component's ref was pointed at its host element at creation and never read again, while an inline
`ref={createRef()}` handed the child a new object every parent render — one wasted child render per
parent render, measured, with nothing to say so. **"Never read again" stopped being true.** `Select`
and `TextArea` take the element's ref for themselves, so each hands the CALLER's ref the node by hand
and re-checks it on every update. With `ref` out of the comparison there was no update to re-check
on: the component was never queued and `rawProps` was not even replaced. `Select` was saved only by
always having children to rebuild.

`ref` is compared like every other prop now. A stable `ref={this.field}` costs nothing — the value
is identical, so nothing is notified. And it fixes a second case nobody had noticed: `ref` used to be
subtracted from the key COUNT on both sides, so `<Child ref={r} />` becoming `<Child />` read as the
same shape and the ref was never released.

**The wasted render is no longer silent, which is what that exclusion was really for.** Two new
reports, one on each side of the line:

- `RMD061` at runtime, when a `createRef()` is reached from a render, a `@compute`, a `@memoized`
  member or a hook's props callback. One message rather than `RMD021`'s four, because unlike a
  random number the fault does not differ by phase: a ref belongs on a field in every one of them.
- `ref-built-where-it-cannot-be-kept` in `@ramonda/check`, which says the same thing before the line
  runs — including in a branch nobody has rendered. It follows what a render REACHES, so a helper two
  files away and a base class's method are covered, and it judges `createRef` by where the binding
  came from rather than by its name.

The callback form is untouched and belongs on a field: `createRef<T>((node) => this.arrived(node))`
is how `Select` and `TextArea` learn their element has appeared. What must not move is the ref.
