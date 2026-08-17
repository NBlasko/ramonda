---
"@ramonda/core": minor
"@ramonda/devtools": minor
---

The panel says what each `@compute`'s cache actually did.

A `@compute` is a claim that a value is worth caching, and the claim can be false in a way nothing
else reports: the compute is invalidated by something that moves on every pass, so every read runs
the body, tears the dependency set down and builds it again. The answer is correct, so nothing looks
wrong.

The components tab now carries a **Computed** section per instance:

```
Computed
  total   never cached — ran on all 41 reads
  label   18 of 21 reads cached
```

**A measurement, not a verdict, and that is the design rather than caution.** A compute that never
hits may be perfectly reasonable — its dependencies may genuinely move every time, and a plain
getter would be no cheaper. What is worth showing is the gap between "cache this" and "nothing was
ever cached"; the person reading their own component is the one who can close it. The heading was
nearly "Wasted computes", which is a verdict the panel is not entitled to make, and correct code
would have been sitting under that word.

RMD024 is the neighbouring check and stays where it is: it catches the strictly narrower case that
IS a fault — recomputing to an equal value several times running. A compute that misses every time
and returns something different every time is invisible to it, correct, and still paying for a cache
it never uses.

Per instance, not per class: two rows of one component are two different questions, and one of them
never using its cache says nothing about the other. A compute nobody has read yet is left out
entirely rather than shown as `0/0`, which would read like a finding about a compute that has simply
not been asked for.

**The production cost is two bytes, and getting there took a measurement worth recording.** The
counters started as two fields on the compute's cache object: 16 bytes of production bundle and two
hidden-class slots per compute per instance, for something no production build can read. Moving them
to `const counters = __DEV__ ? { hits: 0, misses: 0 } : undefined` with a later `if (counters)` made
it **worse** — esbuild folded the ternary but did not propagate the constant into the branch, so the
counters and both increments shipped anyway. With `__DEV__` leading every guard the minifier sees
`if (false)` and deletes the block: `misses` appears nowhere in the production bundle and the raw
total moves 62160 → 62162.

Also worth carrying, having now seen it three times: the gzipped total across separately-compressed
chunks moves by ~100 bytes on a change worth 2, because the chunk boundaries shift. For a change
this size the raw total is the honest measure.
