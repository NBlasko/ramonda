---
"@ramonda/core": minor
"@ramonda/query": patch
"@ramonda/form": patch
---

`@watchProp` takes several selectors and runs once when any of them changed

```tsx
@watchProp((p) => p.page, (p) => p.term, (p) => p.sort)
reload(next: [number, string, string], previous: [number, string, string]) { … }
```

**"Run this when any of these props changed" was previously unwritable.** Stacking the decorator makes a
separate entry per selector, so the method runs once per CHANGED prop — twice when two moved in the same
update. And selecting a tuple from one selector is worse: comparison is `Object.is`, so a fresh array is
never equal to the last one, and the method fires on **every** props change with `previous` and `next`
holding identical contents. Both measured; both are now covered by tests.

Comparison stays `Object.is` per selector, so nothing is compared deeply and the cost is unchanged. Only
the CALL is coalesced. A selector whose value did not change keeps it in both arrays, so
`previous[i] === next[i]` is how the method tells which one moved.

**Breaking: the values are always a tuple, including for one selector.** `(next: string)` becomes
`([next]: [string])` — destructuring in the parameter list leaves every method body untouched.

That is about evolution rather than neatness. With a scalar for one selector and a tuple for several,
adding a second selector to a watcher that already exists silently changes the method's parameter type,
and what a decorator reports for that is `TS1241 Unable to resolve signature of method decorator`, which
names nothing useful. A tuple that grows leaves `next[0]` meaning what it always meant.

**Two of this package's own call sites were silently wrong after the change and the compiler accepted
both**, which is worth knowing if you have your own: a parameter typed as a deferred conditional
(`InferIn<S>` in `@ramonda/form`) or as anything array-shaped (`QueryKey` in `@ramonda/query`, which is
`readonly unknown[]`, so a one-tuple is assignable to it) type-checks and then receives the tuple.
`@ramonda/form`'s late-defaults suite caught it; the types did not. Audit by shape, not by `tsc`.
