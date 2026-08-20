---
"@ramonda/check": patch
---

`row-reads-a-plain-field` and `cached-read-of-a-plain-field` now share one judgement about which fields
can go stale, instead of holding two copies of it.

The two rules landed within a day of each other on separate branches, and the second copy was worse in
four ways — all four found by running the older rule against the newer one's fixture:

- a field written in the **constructor** was reported, though that runs before the first render;
- the **memo pattern** — `if (!this.cache) this.cache = expensive()` inside `render()` — was reported,
  where advising `@state` advises a loop;
- a field written in **`@destroyed`** was reported, after the last render, with nothing left to be stale;
- and **`@persist` was treated as reactive**, which is a MISS rather than a false report: it carries a
  value across hydration without tracking it, so a row that shows one is exactly as stale as a row
  showing a plain field. The other rule reported that same field from its own side, which is what proved
  it.

`rules/stale-field.ts` is that one judgement: which fields a cached reader can go stale on, and which
writes count. A `@compute`, a hook's props callback and a stable `list()` row callback are three cached
readers with one question between them. The rules stay separate, because the readers are found in
different places and the fixes differ — a row can be made inline, a `@compute` cannot.

No behaviour change to `cached-read-of-a-plain-field`: its 363 tests pass unchanged.
