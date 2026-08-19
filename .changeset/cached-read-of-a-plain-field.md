---
"@ramonda/check": minor
---

A new rule: `cached-read-of-a-plain-field` — the static half of `RMD027`, and of a `@compute` fault
that has no runtime code of its own.

A `@compute` caches and recomputes when something it **tracks** changes: state and props. A hook's
props callback caches the same way — `this.use(Form, () => ({ schema: this.schema }))` is not called
again on a render where none of the signals it read moved. An ordinary field is neither, so writing
one invalidates nothing and both keep the answer they already had.

Measured, with `@state tick`, a plain `rate` and `@compute get total()`:

| step | on screen | truth |
|---|---|---|
| `rate = 10`, no render | `0` | `0` |
| `tick = 1` → renders | `10` | `10` |
| `rate = 100`, then an **unrelated** state change renders | **`10`** | `100` |

The last row is the fault and it is the bad kind: the page re-rendered, everything else on it
updated, and this one value is the answer from before. Nothing throws.

**One rule rather than two**, because the fault is one: the same set of fields, the same writes, the
same fix. The runtime names the same root cause for the props-callback half — "most often a plain
field standing in for state" — and two rules would have been two copies of every judgement about
which writes count.

Four kinds of write cannot make anything stale and are not reported: the constructor and `@created`
(before the first render), `@destroyed` (after the last), and a write from inside the reader itself,
which is the memo pattern where advising `@state` would be advising a loop. A field holding a hook or
a function is not a plain field, and `this.use(Hook, someFactory)` is a value this cannot follow.

Renamed from `compute-reads-a-plain-field`, which had never been released: the id was its claim, and
the claim grew.
