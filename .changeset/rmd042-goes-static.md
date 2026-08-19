---
"@ramonda/check": minor
---

A new rule: `listener-on-the-default-host`, the static half of `RMD042`.

Without `@Host` a component's host element is `<ramonda-host style="display: contents">`, and that is
the point of it: it takes part in no layout, so the markup inside lands in the parent's grid or flex
row as if the component were not there. What it has no part in is being a **target** — an element
with `display: contents` generates no box, so nothing can be over it.

An event that bubbles still reaches an `@onElement` listener from the children, so half of those
work. One that does not bubble — `mouseenter`, `mouseleave`, `focus`, `blur`, `scroll` — never
arrives at all, and the handler simply never runs. The report says which of the two it is looking at,
because the difference is the difference between "mostly fine" and "dead".

Both halves are decorators, so it is syntax: `@onElement` on a member and no `@Host` on the class.
`@Host` is inherited — the tag is read from the constructor — so the heritage is walked, and a
component extending a `@Host`-ed base has a real element. A `@Host` whose tag is a callback makes it
go quiet: what that returns is decided at runtime.

`@onWindow` and `@onDocument` are untouched, since they resolve to the globals whatever the host is.

Nothing in this repository trips it, and the reason is worth knowing: every `@onElement` in it is
paired with a `@Host`, which is the correct pattern. Proved by removing one `@Host` from a real
component and watching the listener beside it be reported.

The review of this branch caught the version that would have shipped **silent for every component
anybody outside this repository writes**. It treated a base it could not read as "has a host", and
in a real application `@ramonda/core` resolves to a `.d.ts` — so `class Bare extends Component` hit
that branch every time. It only worked here because the workspace maps the package at its source.
`Component` and `Hook` now END the chain, which is what they are: the default host is what a
component gets by not having one. Verified against a project pointed at the built `.d.ts`, and every
other rule on this branch was checked the same way.
