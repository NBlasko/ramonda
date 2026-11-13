---
"@ramonda/router": minor
"create-ramonda": minor
---

A route table can be put together from parts: `createRoutes(playerRoutes, { "/": <Home /> })` takes tables other modules made, literal ones, and `undefined` for a part a condition leaves out — matched in the order given. A spread could not do this, because the table `createRoutes` returns is compiled.

`createRoutes` now refuses, when the table is built, a path two parts both name, a second `"*"`, and a route an earlier pattern matches first (`"/players/new"` after `"/players/:id"`), which could never be reached.

**Breaking:** tables are registered under a name — `declare module "@ramonda/router" { interface Routes { app: typeof routes } }` replaces `interface Register { routes: typeof routes }`. The name lets a module lifted into a package register its own routes beside the app's. Rename the two words in your registration; nothing else changes.
