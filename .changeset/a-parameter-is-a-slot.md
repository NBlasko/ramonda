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
  "via": "parameter", "slot": "type", "at": "@ramonda/core/src/jsx-runtime.ts:55:7" }
```

`parameter` is a new `via` value, which is what the format's split between `kind` and `via` exists
for: a reader that switches on `kind` is unaffected. It is a second value rather than a flag on
`slot` because a prop edge is FILLED from what a JSX call site binds and a parameter must never be
— a package whose `Frame.show(view)` mounts its own argument, spliced into an app writing
`<Frame view={Foo} />`, would otherwise have `Foo` judged under `Frame`.

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

**Four faults a review found on this branch, all of them in the new code:**

- `this.use(hook)` written WITHOUT a cast resolved to the parameter's own symbol and so missed the
  branch that marks a component opaque — silenced but transparent, which is the worst of both: a
  consumer below it reported against a component that may well have been providing for it, and no
  hole left to point at the cause. Only the cast spelling was covered, so the tests passed. Opacity
  is keyed on the value tracing to a parameter now, and **not** on merely reaching that branch:
  widening it is the opposite fault, and `this.use(Form<typeof schema>)` arrives there too.
- A `ramonda-check-ignore` already written on a site that becomes a slot went silently dead — out
  of the list printed on every run, which exists so the number cannot creep up unread, and an EMPTY
  directive was accepted there while being refused everywhere else. It is read before the edge is
  emitted now.
- A root's reason was computed from a JSX element that is absent when the argument is not JSX, so
  the edge said it waits on `vnode` while its own `why` said there was nothing to wait on.
- The format's own documentation for `slot` still described a prop. It says what it now carries,
  and that neither kind belongs in a node's `slots`: the `from` of a parameter edge can be a root
  or a free function, which have no props at all.

**And two more from a second review, over the fixes themselves.** A spliced fragment filled a
parameter from a colliding prop name — the fault above, found before it could bite and pinned by a
vendor package that mounts a method argument. And the exemption for a PROP never read its own
directive either, so the two symptoms fixed above still held there: both call one reader now.
