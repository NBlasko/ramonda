---
"@ramonda/devtools": patch
---

Two bugs that only the real bundle could show, and a check that now drives it.

**The edit pencil did nothing on any row under a hook.** It packed `nodeId|key|valueId` into one
attribute — and a value id contains the node's path, which marks a hooks branch with `|h`. So
`split("|")` on `1|routeState|/0:component:App|h/0:hook:Router::s::routeState` handed back a truncated
id, the lookup missed, and the click was swallowed. Three attributes now, no delimiter over data. The
editor button was built the same way and is fixed the same way.

This is the third time the same mistake has appeared in this panel — a query hash inside a selector, a
prop name inside a selector, a path inside a delimiter. Never build a delimited string out of data that
can contain the delimiter.

**A component from another package could not be opened.** For a bundled development build the map names
its inputs as a `../../..` chain out of the bundle's directory *on disk*, and the panel resolved that in
the browser — where `new URL()` clamps at the web root and turns
`../../../../../packages/router/src/Link.tsx` into `packages/router/src/Link.tsx`. The server then looked
for it under the app and answered 422. The source now travels exactly as the map wrote it, alongside the
module it came from, and the server does the arithmetic — it is the only party that knows a URL of
`/assets/client.js` is a file under `dist/client`.

**And the SSR playground's smoke test drives the panel now**: it loads the real bundle into jsdom,
opens the tree, clicks a pencil and asserts an editor appears, then asks the editor endpoint to resolve
a path read out of the bundle's own sourcemap. Both bugs above fail it. 102 unit tests could not see
either, because a test tree writes its own paths and a mocked fetch answers its own questions.
