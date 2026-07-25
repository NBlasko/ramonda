---
"@ramonda/core": patch
---

Add **RMD019**, a dev-mode diagnostic for non-serializable `@state`.

`@state` is carried to the client in the hydration blob as JSON, so it can only hold
JSON-serializable data. Assigning a **function**, **symbol**, or **bigint** to a
`@state` field — at its initializer or a later write — is now reported (dev only), at
the moment it happens, on the client too. Previously this was only noticed by the SSR
serializer, and only during a server render.

The check is scoped to `@state` (not props, which legitimately hold callback
functions) and is O(1), so it stays off the hot path's back. Deeper cases (a `Map`, a
circular object) remain the SSR serializer's job.
