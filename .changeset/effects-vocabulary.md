---
"@ramonda/core": patch
"@ramonda/query": patch
---

The documentation no longer teaches a decorator that does not exist.

`@effect` was removed in 0.1.0, and the word stayed behind: the root README listed it among the
decorators, core's README had a table row for it, `@ramonda/query`'s README explained mutation rollback
by comparing it to "the cleanup contract `@effect` uses", and the sidebar group was called *Lifecycle and
effects*. A reader following any of those looks for something that is not there.

The `/concepts/subscriptions` page also stopped explaining itself as a migration. Its "There is no
`@effect`" section was written for someone who had used the old decorator; it now answers the question a
reader actually arrives with — *where did `useEffect` go* — with a table from what you want to the name it
has here, and keeps the reason: an effect is defined by its dependencies rather than its purpose, so one
decorator would have to be all four of those things, and which one it was would depend on what its body
happened to read that render.

Elsewhere "effects" was the runtime's own vocabulary leaking into prose a reader cannot look up ("after
this commit's `@mount`s and effects"); those say *subscriptions* now.
