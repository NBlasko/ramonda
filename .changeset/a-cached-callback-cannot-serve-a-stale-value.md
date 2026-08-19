---
"@ramonda/core": minor
---

A cached callback can no longer serve a stale value — `list()`'s rows and `@memoizedHandler`.

Two caches in the framework decided when to re-run a callback from the signals that callback READ. Reads
are tracked wherever they happen — any call depth, any module, measured through two helpers in a second
file. What neither cache could see is a value read OUTSIDE the callback and closed over, and both served
it for ever.

**`list()`.** A row callback that captured a local kept the first value for the life of the list:

```tsx
const label = this.label;
list(rows, () => <li>{label}</li>)     // "old", for ever
```

Measured: `"old"` in the row where the same field in the markup beside it read `"new"`. A `@state`
signal read one line too high behaves identically — the trigger was never "a plain field", it was "not
read inside the callback".

Nothing can look inside a closure and enumerate what it captured, so the engine goes by what it can see:
**a callback whose reference is new might have captured anything, so its rows are rebuilt; a callback
that cannot capture a render's locals keeps the fast path.** Measured over three renders — a class
method gives 1 distinct reference, a module-level function 1, an inline arrow 3 — so one identity check
separates every form with nothing static and no guessing. The whole-list skip is gated on it too, which
is the half that is easy to miss: it returns the cached node without calling the callback at all.

**What it costs, measured at 10 000 rows over five re-renders:** the stable form does 0 row builds and
the inline form 50 000 — and **both do 5 DOM writes.** The diff finds the rows identical and touches
nothing, so the price is closures and small objects and never the document. Wall clock could not answer
it here and is not quoted: jsdom swung wider than the effect, and one attempt was outright invalid.

**`@memoizedHandler`.** The same shape. The cache is keyed by the arguments, so the method runs once per
key and whatever it read on that call is frozen into the handler. Measured: a builder reading
`this.prefix` served `"old:a"` on every click while `prefix` already said `"new"`. The builder now runs
inside a tracker and a change to anything it read **drops that one entry** — per entry, not the map,
which is what keeps a handler built for other arguments identical:

```tsx
pick(id) { let val = 0; if (id === 2) { val = this.mode; } return () => …; }
```

`pick(1)` read nothing, so its function never changes. Only `pick(2)` is rebuilt. Both halves are pinned,
and wiping the map instead fails the second.

**What the review caught, and it was the important half.** The first version of the memo fix REPLACED the
enclosing tracker instead of forwarding to it, so the builder's reads were visible to nothing: the entry
was dropped when the signal moved, but the region holding the handler was never invalidated and the stale
handler stayed in the DOM. Measured in the decorator's canonical use — one handler per list row —
`"old:a"` on both clicks. The deps are now forwarded through `trackDependency` on the way out, on the hit
path as much as the miss path, exactly as `@compute` and the props cache do and for the reason they
document. And the per-entry subscriptions are released from `clearReactives` on destroy, which the first
version also missed: a builder reading a signal that outlives the component left its listener attached
for the life of the page.

**Free for correct code, in both places.** A row callback written as a method, and a handler builder that
reads nothing, track nothing and are never invalidated — which is the whole purpose of each cache. When a
signal WAS read, a rebuild is the honest answer: the row or the handler behaves differently now.

**A pre-existing fault came with the review and is fixed here**, because it lives in the same set of
remembered fields: `list(undefined, …)` returned an empty node while still remembering the array from the
pass before, so handing the same array back later matched the whole-list skip against that empty node and
the rows never returned. Measured on `main` as well: `rows → undefined → the same rows` gave 2 rows, then
0, then 0. Pinned for both callback forms.

Both halves are real runtime code rather than development checks, and the production bundle grew by
**146 B gzipped** — 21043 → 21189, measured by bundling `core`'s entry with `--define:__DEV__=false`
against the same file on `main`.

Ten tests across `ListCallbackIdentity.test.tsx` and `MemoizedHandlerStaleness.test.tsx`, including the
four nested-list combinations (both inline, both stable, only outer, only inner) and the boundary that is
NOT fixed and now says so: a stable callback reading a plain field still caches it, exactly as a
`@compute` over a plain field does.

Seven existing tests moved their mapper to a method, because that is now the form the cache applies to —
their intent is unchanged and each says why beside itself. Documented on `/lists` and `/concepts/events`.
