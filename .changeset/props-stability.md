---
"@ramonda/core": minor
---

`stable()`, and RMD022 — the strict render now covers a hook's props callback.

`render()` and a props callback are the same kind of thing: code the framework calls
unconditionally on every render, whose result is compared against the last one. `render()`
had both a check and the tools to satisfy it (`@memoizedHandler`, `list()`); a props bag
had neither. Now it has both.

**`stable(value)`** keeps an array or object in a bag at one identity for as long as its
contents are equal — the counterpart of `list()` for a props bag:

```tsx
private user = this.use(Query, (self: UserCard) => ({
  key: stable(["user", self.props.id]),   // the same array until `id` moves
  fetch: self.load,                        // a bound method is already stable
}));
```

It runs in production too: this is behaviour, not a diagnostic. Contents are compared by
value to a bounded depth, so a nested literal gets a fresh reference rather than a wrong
one.

**RMD022** calls the callback twice in the same tick and compares the two bags, reporting
a rebuilt array (`stable()`), a rebuilt closure (a bound method, or `@memoizedHandler`),
or two different contents (the callback is not a function of state). Part of the strict
render, so `configureDev({ strictRender: false })` turns it off with RMD020.

**Why it matters more than "an extra allocation".** Every prop is a signal, and a signal
compares by reference, so a rebuilt array is a *changed* prop. Measured across three
renders of the owner: a hook `@compute` reading a rebuilt array runs 3 times where one
reading a scalar prop runs once; a `@watchProp` on a rebuilt array fires on every update
render; a child component handed a rebuilt function re-renders 3/3.

**Why twice on every render, not once at the start.** A callback with an `if` in it only
ever proves the branch it took, so a first-render-only check passes the case that breaks
later — while reporting the legitimate branch difference as a fault.

Also in this release: a production build test. `apps/docs` now builds a fixture
application and asserts that no diagnostic code, no diagnostic message and no devtools
reach the output, with a development build as the control so the test cannot pass
vacuously. It immediately found a real leak: a DEV gate written as `if (!__DEV__) return …`
with the checks after it, rather than `if (__DEV__) { … }`, left `checkPropsStability`
reachable and pulled `diagnose` — and every diagnostic's title and fix text, all 21 of
them — into the production bundle.
