---
"@ramonda/check": minor
"@ramonda/core": patch
"@ramonda/testing-library": patch
---

A value the caller hands in is a slot, whether it arrived as a prop or as a parameter.

`<this.props.view />` has never been a defect: nothing in that class can say what it mounts, and
nothing was meant to. `__h(type, …)` inside a JSX runtime is the same promise written differently,
and reporting one and not the other made the framework apologise for being a framework — thirteen
escape hatches across this repository against a plan whose own test is that more than a handful
means the rule is formulated wrongly.

A mount whose named value traces to a parameter is now an edge that says what it waits on:

```json
{ "from": "@ramonda/core/src/jsx-runtime.ts#jsx", "kind": "unresolved",
  "via": "slot", "slot": "type", "at": "@ramonda/core/src/jsx-runtime.ts:55:7" }
```

A path works at any depth (`options.wrapper`), a cast is seen through, and `this.use(hook)` makes
the same promise about a hook. **Thirteen annotations become five**, measured by deleting all
thirteen and running every project: core keeps none, testing-library two, the documentation site
one, the playground its two deliberate failed-load demos.

**What stays a hole**, because reading either means running something: what a CALL returns
(`bootstrap(wrap(ui), container)`) and whatever a LOCAL BINDING was last assigned
(`const tag = …; __h(tag, …)`).

**The cost, plainly.** A mount whose value came from a parameter is no longer an error anywhere, an
app's own helper included. It is a marked blank rather than a reported one. What it does not buy is
coverage: nothing fills these — the compiler calls `jsx`, and a wrapper handed through a call
argument is not a JSX binding.

**A latent false positive fell out of it, and it is the more useful half.** Judging and walking
shared one early return, so everything below an OPAQUE component was unreached — and the
dead-declaration rule read that as "nothing mounts this" with the tag one line above it in the same
file. The two questions are now separate: what a component provides is unknowable below an opaque
one, and what it mounts is written in its body and perfectly visible.

`@ramonda/core` and `@ramonda/testing-library` lose the annotations they no longer need; nothing
else changes in either.
