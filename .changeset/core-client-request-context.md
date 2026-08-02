---
"@ramonda/core": minor
---

`requestContext()` now works in the browser — and opting a value into the client is explicit.

**Fixes a real gap:** nothing installed a request scope on the client, so a component that read
`requestContext()` directly in `render()` worked on the server and **threw during hydration**
(`"requestContext() was called outside a render"`). `hydrateRoot` and `bootstrap` now install a
browser scope, so such a read returns a value (if it was exposed) or nothing — never a crash.

**Nothing travels unless you say so.** A key opts in:

```ts
export const currentUser = requestKey<User | null>("currentUser", { exposeToClient: true });
```

Exposed values ride one blob on the root element (`data-ramonda-request`), and the browser reads
them back through the same `requestContext().get(key)`. Everything else stays on the server:
**cookies and headers can never be exposed** (they are the server's, and an httpOnly cookie is
invisible to JS anyway), and a key that did not opt in does not travel. Reading any of those in
the browser returns nothing and reports the new **RMD025** in development, rather than throwing —
breaking the page would be worse, and a real divergence is already reported by hydration.

Also: in the browser `requestContext().url` follows the address bar, so it stays correct after a
client-side navigation instead of freezing at whatever the server rendered.

Most apps need none of this — reading the request in `@create` and keeping the result in `@state`
already travels, because `@create` is skipped on hydration and the state is restored from the page.
`exposeToClient` is for when several components read the same value straight from the context.
