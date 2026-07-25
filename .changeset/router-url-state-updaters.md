---
"@ramonda/router": patch
---

Race-free URL state, clearer names, and scroll as an explicit choice.

**New: partial-state updaters.** `updateSearchParams(next, opts?)` and
`updateHashTags(next, opts?)` change only the query or only the hash. The functional
form receives the freshest state, so two filters changed in the same tick serialize
instead of clobbering each other. They stay in place (no scroll) unless `{ scroll: true }`
is passed, and default to a new history entry (`{ replace: true }` to avoid filling
history while typing). Available on both `Navigator` and the `Router` instance.

**BREAKING: `RouteHook` is renamed to `Navigator`.** `Router` (mounted once at the
root) and the everyday hook were too easy to confuse; `Navigator` reads distinctly and
can't be pulled in by accident. Replace `this.use(RouteHook)` with `this.use(Navigator)`.

**BREAKING: the `shallow` option is removed** (from `<Link>` and `NavigateOptions`).
Routes match on the path only, so a query- or hash-only change never re-matches — it is
inherently a same-page update, with nothing to "skip". The one real choice, scrolling,
is now explicit: `push`/`replace`/`<Link>` scroll to the top by default (pass
`scroll: false` to stay put), while the in-place updaters don't scroll unless asked.

`Router` now also exposes the read/navigate surface (`pathname`, `searchParams`,
`hashTags`, `push`, `replace`, `updateSearchParams`, `updateHashTags`, `back`,
`forward`) — everything a `Navigator` has except `params()`, which needs a
`<RouteOutlet>` below it.
