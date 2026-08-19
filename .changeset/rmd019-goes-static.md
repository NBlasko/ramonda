---
"@ramonda/check": minor
---

A new rule — **`unserializable-state`** (`RMD019`, `RMD033`) — and a second gate for the rules that
only mean something under server rendering.

The server's state travels to the client as JSON, so a `Map`, a `Set`, a `Date`, a `RegExp`, a class
instance or a function does not survive the trip. None of them **throws** on the way out, which is
what makes it quiet: `JSON.stringify(new Map())` is `{}` and a `Date` arrives as a string, so the
client starts with a value of the wrong shape and fails later, somewhere else, on a method the value
no longer has.

**The gate is the interesting half.** `@state` holding a `Map` is perfectly correct in a project that
never renders on a server — there is no blob for it to cross — so reporting it would be reporting a
working application. `needsServerRendering` is therefore a second `needs`: a browser-only project
does not **skip** the rule, it is not part of that run at all, which is the same stance the router
rule already takes about a project with no router.

Decided from IMPORTS, once, by the same argument `needs` makes: core's `renderToString`,
`renderPage` or `renderStatic`, or `hydrateRoot` — the client half of the same story, since a
project that hydrates was rendered on a server by definition. `@ramonda/server` answers on its own.

Proved both ways with the same fault planted in two real projects: two reports in `apps/docs`, and
none in `apps/playground`, which imports no server entry. The fixtures are the same components with
one import between them.

`lossyIn` — the reader that walks an initializer into object and array literals — now lives in
`rules/lossyValue.ts` and is shared with `persist-of-a-lossy-value`. The two ask the same question
about the same blob, and two copies of that table would be two answers waiting to disagree about
somebody's `Date`.

A field that is BOTH `@state` and `@persist` is left to the ungated rule: `@persist` says the field
is meant to travel whatever the project does about servers.

The catalogue's "no code claimed twice" check is now a declared table of pairs instead. Three codes
genuinely have two rules — each pair being two halves of one code rather than two rules saying the
same thing — and writing them down makes a third claimant a deliberate act rather than something
nobody notices.
