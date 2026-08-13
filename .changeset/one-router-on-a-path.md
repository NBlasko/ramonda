---
"@ramonda/check": minor
"@ramonda/core": minor
"@ramonda/router": minor
---

A context can say that two of it conflict, and a second one is reported before the app runs.

Nesting is ordinary: a second Provider shadows the first and the nearer one wins. That is how a
theme override inside a panel works, and a form inside a form — so a checker cannot simply report
every context provided twice.

`createContext(…, { single: true })` is how an author says this one is different. The router's is the
case, and it now declares it: two Routers both listen to `popstate` and both write history, and the
first to unmount takes the listener the survivor depends on. `Router.init` already throws when it
happens — this is the same fault said before anything renders, on every path the source can produce,
including the branch nobody clicked.

Like `label` and `optional`, the flag is a declaration rather than behaviour: the runtime reads
neither, and it changes what is reported rather than what is read. It travels in a package's graph
fragment, so a context declared single stays single in every app that mounts it.
