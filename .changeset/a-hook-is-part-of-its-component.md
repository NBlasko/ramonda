---
"@ramonda/check": patch
---

A hook is an extension of the component that uses it, and the graph now says so once instead of twice

`this.use(X)` is a `uses` edge and never a mount, so the walk that follows mounts left every hook out
of all three of its answers: not reached, no arrival recorded, no path naming it. Two rules patched
that locally, each closing the reached set over `uses` for its own question — and the patch was worse
than the hole. `deadOnes` widened the SHARED set (a hook nothing uses is not dead), and
`readsOffTheRoute`, which runs after it, then read a hook as reached while the arrivals still knew
nothing about it. A hook reached with no arrival is exactly the state that rule reports as "no outlet
above".

**So correct code failed the build.** Measured: a hook reading `params("/teams/:teamId")`, used by a
component mounted at exactly `/teams/:teamId`, was reported. The router runs it happily, and every
rule is an error.

The closure happens once now, before any rule reads anything, and carries the arrivals with it: a
hook inherits the routes of every component that uses it, which is what the runtime does — the params
it reads are the ones published above its user. Any rule written after this reads hooks correctly
without having to know they exist. It is a fixpoint rather than one pass, because two hops down a
node can be closed before the arrival that condemns it has arrived.

The same read is now reported with the truth instead: `why: "wrong-route"`, the route above the user,
the missing name, and a path that says how the hook got there — `App > RouteOutlet > TeamPage >
WrongInHook`.
