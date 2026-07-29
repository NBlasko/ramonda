---
"@ramonda/query": minor
"@ramonda/devtools": minor
---

A QUERY tab in the devtools panel.

Every entry in every live cache: the key, status and fetch status, how many components are
watching, how long ago the data arrived, a preview of it, the failure count, and whether it
came from a server render. Per row, **invalidate** (mark stale and ask whoever is watching to
refresh) and **remove** (throw the data away).

**No refetch button**, and that is the design rather than an omission: the fetcher belongs to
the observer, not to the cache, so a query nobody is watching has no function to call.
`invalidate` is the honest equivalent — the same thing a mutation's `invalidates` does.

**Pull, not push.** The panel is a custom element outside the tree, so it cannot see a
provider; `@ramonda/query` installs `__RAMONDA_QUERY__` in a development build and the panel
calls it while its tab is open, four times a second, and not at all otherwise. That is the
model core already uses for `__RAMONDA_INSPECT__`, and the reason is the same: a cache changes
on every fetch, every observer arriving and leaving, every invalidate and every sweep, and
pushing all of that into a panel nobody is looking at would cost something in every
development build.

**Providers register, clients do not.** A client belongs to a provider and there can be
several, so registration happens in the provider's `@create` (client only — a server render
has no panel, and `@destroy` never runs there) and is undone in `@destroy`. A torn-down tree
therefore takes its cache out of the list, so the panel cannot hold one alive or show one
that no longer exists.

Ten tests on the bridge, plus one in the production run asserting the global is never
installed. Two of them are notes rather than checks: `remove` on a key something is still
watching does not make the row vanish — the observer re-subscribes onto a fresh entry and
fetches again, because `remove` notifies observers with `"removed"` exactly so they stop
rendering something deleted — and a row whose entry was collected between being drawn and
being clicked is looked up fresh, so an action on it does nothing instead of throwing.

One finding recorded in the code: `@create` ignores what it returns. A teardown returned from
it is silently dropped — that contract belongs to `@effect` and `createSubscriptionDecorator` —
so the registry grew by one per test until the two halves were written out as `@create` plus
`@destroy`.
