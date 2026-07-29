---
"@ramonda/core": minor
"@ramonda/query": patch
---

**BREAKING: `@effect` is removed.** Every case it served has a decorator that says what it
is for, and having one that said nothing was what made circular updates easy to write.

Where each case went:

| what the effect was doing | what to use |
|---|---|
| subscribing to something outside | `createSubscriptionDecorator` — same "return the cleanup" contract, and it re-connects when a signal its `connect` READ changes |
| reading the DOM after the commit | `@updated` |
| reacting to a prop | `@watchProp` |
| deriving a value | `@compute` |

The machinery is untouched. `attachEffect` still runs the queue after the DOM work, and
`createSubscriptionDecorator`, `@onElement`, `@onWindow`, `@onDocument`, `@interval`,
`@timeout` and `@deferHydration` are all still built on it. What went is the door that
handed the raw body through with no contract about what it returned.

**Why, in one sentence:** an effect was whichever of those four it happened to be, decided
by what its body read — so two of them writing what the other read re-triggered each other,
and nothing could name the cause. RMD009 caught the loop but could only say "this component
rebuilt 50 times", and its fix text had to guess. Naming what a piece of code is for is what
lets the framework say something useful when it goes wrong, and makes the ordering knowable
instead of emergent.

`Head` was the framework's own last user, and the migration made it smaller: as a
`@watchProp` whose selector returns a serialized form, the comparison is by value for free
and the `appliedSnapshot` guard field is gone. That guard only existed because effects run
child→parent while `@create` runs parent→child, so an effect handed a nested route's title
back to its layout on the first commit. A `@watchProp` runs in the same order as `@create`
and does not fire on mount, so both halves agree and the deeper `Head` wins.

Also in this release, from the same pass:

- The docs page `/concepts/effects` is now `/concepts/subscriptions`, and it states what
  each of the four replacements is for and when it runs.
- RMD009's, RMD008's, RMD011's and RMD019's fix texts named `@effect` as the usual cause;
  they now name `@updated` and subscriptions, with the line that matters spelled out — a
  post-render write must CONVERGE, because assigning the same value is not a change and
  schedules nothing.
- Tests of the shared machinery kept their coverage through a harness in `src/test/`
  (`effectLike`), which is `createSubscriptionDecorator` with the decorated method as the
  whole connect. It lives in `test/` on purpose: it is a way of saying "an effect, unnamed",
  which is the thing that was removed.
