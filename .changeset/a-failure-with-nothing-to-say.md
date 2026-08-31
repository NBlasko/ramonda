---
"@ramonda/query": minor
"@ramonda/core": patch
---

A query's failure is always an `Error`

`query.error`, `mutation.error` and an `InfiniteQuery`'s were `unknown`, and honestly so: a fetcher
is app code and rejects with what it likes. Measured, a rejected string, number or plain object
reached `error` exactly as thrown.

The cost was paid at every call site. The obvious read is `(error as Error).message`, which is
`undefined` for three of those four shapes — so the page rendered an **empty** failure in the one
place a reader needs words. This repository taught that read in nine places, including the
`@catchError` example in `@ramonda/core`'s published types.

A rejection is now normalised where it is caught: an `Error` is passed through as itself, anything
else is wrapped in `new Error(String(thrown), { cause: thrown })`. So `error.message` always says
something, `error instanceof YourError` still holds for an error you threw, and what the fetcher
actually rejected with is on `cause`.

**The types follow the value rather than flattering it.** `error` is `Error | undefined` on `Query`,
`Mutation` and `InfiniteQuery`; `QueryResult`'s error arm is `Error`; `RetryPolicy`,
`RetryDelayPolicy` and a mutation's `onError` all receive an `Error`. Typing them without normalising
would have turned a visible cast into an invisible `undefined`.

**A retry predicate that inspected a thrown non-Error reads `cause` now** — the one thing in here
that can need a change. `retry: (n, error) => (error as HttpError).status >= 500` becomes
`error instanceof HttpError && error.status >= 500`, which is what the docs now show.

It also settles a disagreement between the two halves of a page: a failure restored from a server
render already arrived as `ServerQueryError`, a real `Error`, while the same failure fetched on the
client arrived as whatever was thrown. Identical app code behaved differently depending on whether
the page was server-rendered.
