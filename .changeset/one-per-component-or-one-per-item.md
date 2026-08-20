---
"@ramonda/core": patch
---

A page for the two caching decorators: `/concepts/caching` — "One per component, or one per item".

`@compute` and `@memoized` look alike from outside. Both hold a result, both hand back the same thing
until a signal their body read has moved — and that shared machinery is the visible part, which is why
people reach for the wrong one. The page leads with what actually separates them: **the key**. `@compute`
is keyed by nothing, so there is one value per component; `@memoized` is keyed by its arguments, so there
is one per argument.

So the decision is one question with no grey area — *is there one of this value per component, or one per
item?* — and the page says why a `@compute` cannot do the second: it has exactly one slot, so there is
nowhere to put a value per row.

It also covers what the similarity really is (both watch the signals their body read, both freeze what the
builder captured), that a typed build refuses `@compute` with a parameter so the wrong choice cannot be
made by accident, that `@memoized` caches a value as readily as a handler, that the arguments have to be
keyable, and when the answer is neither.

`/concepts/timers` and `/concepts/refs` move down one place to make room after `/concepts/compute`.
