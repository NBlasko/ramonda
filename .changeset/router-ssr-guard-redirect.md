---
"@ramonda/router": patch
---

Route guards now work on the server's first load.

A guard that navigates during a server render — e.g. a `@mount` that calls
`nav.replace("/login")` when the visitor is not authenticated — used to be a no-op
on the server: it wrote to a history that does not exist and the wrong page was sent,
then the client re-read `window.location` on hydration and snapped back.

The `<Router>` now captures the render's redirect sink (core's
`captureServerRedirect`) at construction. On the server, a navigation records the
target and stops — no history write, no re-render of a tree the response will
discard — and `renderToString` turns that into a thrown `ServerRedirect` for the
server to answer with a 302. On the client, navigation is unchanged. First guard to
fire decides the destination.
