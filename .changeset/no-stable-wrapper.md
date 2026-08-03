---
"@ramonda/core": minor
---

`stable()` is gone, and the comparison behind `@StableProps` no longer guesses from a sample

**`stable()` is removed.** It was the call-site half of a pair — `@StableProps` for a hook you own,
`stable()` for one you do not — and it was the half that put a hook's own semantics into the app's
code. Two things settled it:

- It is a **wrapper that compares**, and any such comparison has to be bounded to be affordable. So
  it quietly stopped helping on a value large or deep enough, with nothing to tell you.
- What it was for belongs to the hook. A reusable hook is written against what it might be handed,
  not against a well-behaved caller — `Query.onKeyChanged` compares the key part by part before
  doing anything, *even though the framework already did*. A hook written that way needs no wrapper;
  one that is not has a problem a wrapper only hides.

**What to write instead.** If you own the hook, `@StableProps` — unchanged, and now the only way to
say it. If you do not, hold the value somewhere that HAS an identity and hand that over:

```tsx
@compute get series(): readonly number[] {
  return [this.props.a, this.props.b];
}

private chart = this.use(SomeChart, (self: Panel) => ({ series: self.series }));
```

Know what that is and is not: a `@compute` is invalidated by the signals it **read**, so its
identity follows its dependencies rather than its contents. One whose answer is coarser than its
inputs — `this.noise > 5`, `items.length` — hands over a fresh value whenever those inputs move,
even though the answer did not, and splitting it in two does not help because invalidation
propagates rather than being deduplicated by value. That is what RMD024 reports, and absorbing it is
the hook's job. RMD022's and RMD024's fix text now say all of this.

**And a real bug, found from `@ramonda/form`.** The comparison behind `@StableProps` compared the
first fifty items of an array and then answered "equal" for the rest — a verdict from a sample,
where its own docstring promised "past the depth **or the width**, two different objects are simply
called different". So two sixty-item arrays differing only at index 55 compared as equal, a declared
prop was handed back its previous value, and the change was gone with nothing reported. It answers
"different" past the width now, which costs a wide array a fresh reference every render — correct,
just not optimal, which is what both bounds were always documented to cost.

One consequence worth naming: RMD020/RMD022 pick their WORDING from the same comparison, so a pair
that is wider than the bound is now described as non-deterministic rather than as rebuilt in place.
A less precise message, never a wrong verdict — something was rebuilt either way, and both messages
say so. The depth bound has always behaved like this.
