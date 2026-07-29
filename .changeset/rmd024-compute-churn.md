---
"@ramonda/core": minor
---

`RMD024` — a `@compute` that recomputes over and over and keeps producing the same answer.

A compute is invalidated by the signals it READ, so if one of them is a rebuilt reference — an
array literal in a hook's props bag, a fresh object handed down as a prop — it recomputes on
every pass and answers the same thing. Its cache does nothing, and the work is silent: the
answer is correct, so nothing looks wrong.

**Neither neighbouring check can see it.** RMD020 renders twice, and inside one strict render
the compute is *cached* between the two calls, so both get the same value. RMD022 compares two
props bags, but skips a prop declared with `@StableProps` or wrapped in `stable()` — and a
compute reading a component's prop is outside its reach entirely.

Three consecutive equal recomputes, not one: a dependency moving while the answer happens not
to change is ordinary, and reporting that would put a warning on correct code. One bounded
`valueEqual` per recompute, development only.

Keyed by instance and member rather than by the cache, because two instances of one component
are two questions and one churning says nothing about the other. The test for that asserts the
report count, not its presence.

The honest limit is stated in the docs: a compute reading *only* something non-reactive — a
counter, `Date.now()` — is never invalidated, so it never recomputes and is never seen. Nothing
can report a value nobody asked for again.

Also in this release: **`@ramonda/devtools` is type-checked.** It had no `tsconfig.json` and no
`check-types` script, so 600+ lines of TypeScript that ship to users were checked by nothing;
`turbo run check-types` now covers 8 packages instead of 7. Found while looking into whether
five packages needed `@types/node` — none of them did (the `node:` match in the router was
`vnode:`), so five dead dependencies were not added, and this was the real hole behind that
note.
