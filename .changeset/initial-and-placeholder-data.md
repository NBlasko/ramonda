---
"@ramonda/query": minor
---

`initialData` and `placeholderData`, and `client.seed()` under the first one.

The difference between them is the reason both exist, so it is stated everywhere they appear:

- **`initialData` goes in the cache.** It IS the answer until something better arrives — every
  observer of the key sees it, and staleness applies, so with the default `staleTime: 0` it
  shows on the first render and is refreshed at once. `initialDataUpdatedAt` says when it was
  actually obtained: without it, a value from `localStorage` looks freshly fetched and a long
  `staleTime` keeps it.
- **`placeholderData` never touches the cache.** It is a stand-in one component shows instead
  of a spinner, and it is gone the moment the fetch lands.

Both accept a function, and it matters more here than it looks: the props callback runs on
every render of the owner, so an inline value is rebuilt every render for the one render that
needs it. The function form is called once, when the value is actually wanted.

**`client.seed(key, data, updatedAt?)`** is the write `initialData` needed and `setData` could
not be. `setData` is an assertion — this is the value now — and cancels a fetch in flight;
`seed` is an offer: use this if you have nothing. So an answer that was fetched, or restored
from a server render, outranks one the app had lying around, and two observers arriving with
their own `initialData` cannot fight over the entry. Seeding happens from `rekey`, so it also
covers a key MOVING: a new key is a new question, and initial data for it should show rather
than a spinner.

**While a placeholder shows, `status` is `"success"`.** That is deliberate: the whole purpose is
that `if (isPending) return <Spinner />` gives way to the stand-in. `isPlaceholder` tells the
two apart. A failure is never hidden — a placeholder covers "nothing yet", not "it went wrong",
or the failure would be invisible and RMQ002 would be its only trace.

A test caught the inconsistency that comes with that decision: `isPending`, `isSuccess` and
`isError` read the entry directly, so they disagreed with the `status` they are shorthand for.
They delegate to it now — the same trap `result` had already shown.
