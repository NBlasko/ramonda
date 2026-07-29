---
"@ramonda/core": patch
---

The development-only browser setup is guarded on `customElements`, not on `document`.

A server render can have a `document` — this repo's own SSR playground gives its Node process a
jsdom one — so `typeof document !== "undefined"` never meant "browser". It did not matter while
every browser API in that block sat inside the dynamic import's `.then()`, which fails on the
server. Moving the devtools mount out of that callback put `customElements.whenDefined` on the
top level, and the SSR playground died at import:

```
ReferenceError: customElements is not defined
```

The panel IS a custom element, so the registry is the capability that actually has to exist.
Guarding on what the code needs, rather than on a proxy for the environment, is the fix.

**And the reason nothing caught it: `apps/playground-ssr` had no `test` script**, so CI ran
nothing against the one thing in this repo that is a real server. It has one now — a smoke test
that spawns the built server as a child process and asks it for `/`, checking the root element,
server-rendered content and a hydration blob. Deliberately shallow and deliberately real: no
jsdom substitute, no mock. `/` rather than `/products`, because that route fetches from a public
API and a smoke test must not depend on the network.

Verified to have teeth: with the old `document` guard restored, it fails with
`the server exited with code 1 before serving anything` and prints the `ReferenceError`.
