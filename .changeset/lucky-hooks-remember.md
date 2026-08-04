---
"@ramonda/core": minor
---

A hook's props callback is cached on the signals it reads

`this.use(Hook, () => ({ ... }))` used to run on every render of the owner. It now runs when a
signal the callback read has moved — the same contract `@compute` gives a getter — and on the
renders where none of them did, the previous bag is handed over unchanged, down to the arrays and
closures inside it.

**Why.** Every prop is a signal, so a rebuilt object was a *changed* prop: a `@compute` inside the
hook recomputed, a `@watchProp` fired, a subscription reconnected — because the owner rendered for
an unrelated reason. The fix used to be the app's to write, and RMD022 asked for it by name. Ten
hooks over five renders with one signal changing, counted: **50 callback calls and 50 hook
recomputes before, 5 and 5 now.**

```tsx
// Written the plain way, and now also the cheap way.
private list = this.use(Filtered, (self: Panel) => ({
  filter: { q: self.query },             // one object until `query` moves
  onPick: (id: string) => self.pick(id), // one closure, likewise
}));
```

`render()` is untouched — it still runs on every rebuild. This skips asking a hook for a bag
nothing it reads could have changed; it does not skip a render.

**What still needs `@StableProps`.** The cache stops the *call*. On a render where the callback does
run, every array and object in it is fresh, and the key that did not change is woken along with the
one that did. That is what the declaration is for, and it is unchanged.

**One thing can break: a props callback reading a value no signal backs.** A plain field standing in
for state used to work by accident — the write scheduled nothing, and the next render for any other
reason rebuilt the bag and carried the new value along. That render no longer calls the callback, so
the hook keeps what it had.

```tsx
class Panel extends Component {
  items: string[] = [];              // ✗ not @state — invisible to the cache
  @state items2: string[] = [];      // ✓
}
```

New diagnostic **RMD027** reports it: under a strict render, a callback the cache skipped is called
anyway and the two bags compared by value. Rebuilt-but-equal objects and closures are not reported —
those are what the cache is for.

**RMD022 now counts runs before it speaks.** It used to report any value built in place, the first
time it saw one. That included `key: ["user", self.props.id]`, where the array genuinely differs
each time and the recommended `@StableProps("key")` would change nothing. It now needs a second
condition — the prop was rebuilt on four consecutive runs of the callback and its value never
moved — the same threshold RMD024 uses. The non-determinism finding (`Math.random()` in the bag) is
still reported on the first occurrence: that is a fault, not churn, and the cache makes it worse
rather than better.
