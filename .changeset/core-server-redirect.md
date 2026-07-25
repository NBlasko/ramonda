---
"@ramonda/core": patch
---

Server renders can now redirect the request instead of producing a page.

New exports `ServerRedirect` and `captureServerRedirect`. When code in the tree
asks — during a server render — to navigate elsewhere (a route guard sending an
unauthenticated visitor to `/login`, say), `renderToString` throws `ServerRedirect`
rather than returning markup. A server boundary catches it and answers with a
redirect (a 302 and a `Location`), so the browser navigates to the right URL and
requests the correct page — instead of being handed markup for the wrong one, which
would then snap back the instant the client read `window.location`.

`captureServerRedirect()` is the low-level primitive the router builds on: called
synchronously while the tree is being built, it returns a function that records a
redirect for *this* render (or `undefined` on the client). First writer wins.
`renderPage` also clears the document head on the redirect path so a long-lived
server process cannot leak one request's head tags into the next.
