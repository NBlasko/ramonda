---
"@ramonda/core": minor
---

The lifecycle decorators are `@created`, `@mounted` and `@destroyed`

`@create` → `@created`, `@mount` → `@mounted`, `@destroy` → `@destroyed`. `@updated` is unchanged, and it
is the reason: it was the only one of the four already naming the moment rather than an action, and one
odd name out of four is a rule nobody can state.

**They report a moment, they do not perform one.** `@mount` reads as an instruction — as though the
method does the mounting — when what it means is "the framework will call you once this is mounted".
`@mounted` says that. So does `@destroyed`: the method does not destroy anything, it runs while teardown
is happening.

`@watchProp` keeps its name for the same reason it should: it IS an instruction. You are telling the
framework to watch a prop.

**One cost worth knowing before you upgrade.** `created`, `mounted` and `destroyed` are the natural names
for a local flag or counter — `let mounted = false` is an idiom — and a local shadows the import, so
`@created` silently resolves to your array. Six files in this repository had exactly that, and the
compiler reports it as `TS1241 Unable to resolve signature of method decorator`, which does not mention
shadowing. If that error appears on a decorator that was fine a moment ago, look for a local with the new
name.
