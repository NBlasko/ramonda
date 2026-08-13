---
"@ramonda/check": minor
---

Fixtures for two arrangements nothing was pressing.

Both were repaired on the strength of reading the code, and no fixture in the repository had the
shape — so a regression in either would have gone unnoticed while every test stayed green. That is
exactly how the `list({ as })` path went stale.

**Two outlets on one page.** Each `<RouteOutlet>` site keeps its own views, and a view reachable only
under the provider its own section mounts is not judged from the other outlet.

**A context that crosses a package boundary.** A package installed from its published files needs a
context an app compiles from source; the app's provider satisfies it, and the path names the
package's own internals — `App → Bare → Themed → ThemedBody`, pointing at
`@acme/ui/src/index.tsx`. A second identity for one context would have failed the build against
correct code.

The dangling-reference invariant is stated for an APP's graph now. A library's fragment is pruned to
its own package, so an edge may legitimately name another package's node — the app splices both and
resolves it, or records a hole with the reason.
