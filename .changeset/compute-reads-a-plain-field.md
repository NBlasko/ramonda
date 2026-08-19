---
"@ramonda/check": minor
---

A new rule: `compute-reads-a-plain-field`.

A `@compute` caches and recomputes when something it **tracks** changes — state and props. An
ordinary field is neither, so writing one invalidates nothing. Measured by running it, with
`@state tick`, a plain `rate`, and `@compute get total() { return this.tick * this.rate }`:

| step | on screen | truth |
|---|---|---|
| `rate = 10`, no render | `0` | `0` |
| `tick = 1` → renders | `10` | `10` |
| `rate = 100`, then an **unrelated** state change renders | **`10`** | `100` |

The last row is the fault, and it is the bad kind: the page re-rendered, everything else on it
updated, and this one value is the answer from before the field changed. Nothing throws, nothing is
reported at runtime, and the value is **wrong** rather than missing.

A plain field read by a compute is a very common correct shape, so the **write** is what makes it a
fault, and four kinds of write cannot: in the constructor or `@created` (both run before the first
render, so the first computed value already has the final one), in `@destroyed` (after the last
render), and from inside the compute itself — the memo pattern, where advising `@state` would be
advising a loop. A field holding a hook or a function is not a plain field either.

There is no runtime half. Seeing this while it runs would mean observing every ordinary property
read during a compute, which needs a proxy over the instance — too much to carry for one report.
