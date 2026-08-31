---
"@ramonda/check": minor
---

`props-written-by-the-receiver` — a component or hook assigning to its own props

`RMD004` and `RMD015` report this at runtime, and the report is the smaller half of what happens:
`core/debug/renderPhase.ts` says the write is *"stopped by the proxy, which throws in every build"*.
So this is not a wasteful shape that still works — it is code that cannot run, which is why the rule
is an **error** rather than the usual warning for a new one. The test is whether any version of the
shape was meant, and a write that always throws was never the plan.

**One rule for two codes.** `RMD004` is a component's props and `RMD015` a hook's; the runtime
separates them only because the two proxies are installed in different places. From the source they
are one sentence.

Four spellings, all reported: a plain assignment, a compound one (`+=`), a `delete`, and an
increment. Followed one hop through a local — `const p = this.props; p.label = …` is the same object
under the same proxy — and through a cast, because `(this.props as Record<string, unknown>).x = 1`
writes exactly what it looks like it writes.

Silent on three things, each for its own reason:

- **Mutating what props point AT.** `this.props.meta.seen = true` sets a key on `meta`, not on the
  props bag, so the proxy never sees it and nothing throws. A real fault of another kind — an object
  the parent owns, changed behind its back — and naming it this one would report a throw that does
  not happen.
- **A destructured value**, which is a local.
- **Another object that happens to be called `props`.** The name is not the subject.

Reports nothing across the documentation app, the packages and the playgrounds, apart from one
deliberate site in `playground-core` whose whole purpose is to make `RMD004` fire — which now
carries its reason, recorded and printed on every run rather than silently ignored.
