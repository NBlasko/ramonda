---
"@ramonda/core": patch
---

`Listener`'s `on` says why it needs `as const`, with both ways out measured

`this.use(Listener, () => ({ on: "document", … }))` does not compile — an object literal widens
`"document"` to `string` — so the call site writes `as const`. Two ways round it were tried on
TypeScript 5.9.3 and written down beside the prop, because "worth a fresh look" is how a question
gets re-derived every year:

- **`NoInfer<Q>` on the props factory**, the textbook fix for a parameter inferred from two places,
  **crashes the compiler**: `Debug Failure. No error for 3 or fewer overload signatures`, thrown
  from `resolveCall`. Not that it fails to help — tsc does not finish.
- **A `const` type parameter** works, and the example compiles with no `as const`. It also keeps
  every inferred array as a READONLY tuple, and hook props take arrays: six call sites in core's own
  tests stop compiling, `children: [<Wrap />, <u />]` among them.

And it is one prop rather than a pattern — `on` is the only hook prop in the framework typed as a
string-literal union, so the `as const` is a single line in a single API.

Comments only; no behaviour and no types changed.
