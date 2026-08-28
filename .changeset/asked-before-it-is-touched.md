---
"@ramonda/check": minor
---

A one-sided global asked about before it is touched is not a fault

`process` does not exist in a browser, so isomorphic code checks first — and checking is the
CORRECT way to write it. `server-env-in-shared-code`, which is an **error**, reported five shapes
that cannot crash:

```tsx
typeof process !== "undefined" ? process.env.REGION : ""     // reported
typeof process !== "undefined" && process.env.REGION         // reported
if (import.meta.env.SSR) return <p>{process.env.DB_URL}</p>  // reported
if (typeof window === "undefined") return <p>{process.env.DB_URL}</p>  // reported
if (typeof process === "undefined") return null;             // and everything after it
```

The last two are the most standard ways anybody writes this, and the early return is how a
`render()` is written far more often than a nested `if`. A build failing against working code is
the one thing this package cannot afford.

`side-guard.ts` answers it once for everyone — `narrowedTo(node, "server" | "client")`, built
alongside `insideADevGuard` and taking the same three climbing shapes plus their inverted forms,
plus the early return that a dev guard never needs. `typeof` on an undeclared identifier is the one
expression in the language that cannot throw, so the test is by NAME and that is right rather than
lazy: a reader writing it is asking about the global whatever else is in scope.

`client-only-request-read` was found to need the same answer. A request read narrowed to the server
inside a click listener never runs, so "the browser reads a value it does not have" is untrue and
the report goes.

`browser-url` and `dom-writes` were asked and deliberately left alone: neither is about a crash.
`browser-url` is about a snapshot that never updates, and a guard does not make it reactive.

The rest of the family came back clean — a subclass is not reported a second time for a base's
shared member, and it inherits the base's `{ env: "server" }` marking.
