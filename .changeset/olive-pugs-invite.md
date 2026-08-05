---
"@ramonda/query": patch
"@ramonda/form": patch
---

The QUERY and FORMS tabs find what was already there when the panel loads

A devtools tab arrives through a dynamic import, so it loads after the app has mounted — and
anything that announced itself during that mount announced to nobody. `QueryClientProvider`
announces from `@create`, which runs during hydration, and its provider sits at the root and never
mounts again: the QUERY tab was empty for the life of the page. `Form` had the same fault and only
looked fine because a form usually mounts on a later route.

Both now answer a request as well as announcing once, and both entries ask on load. The SSR
playground's smoke test asserts the QUERY tab knows of a client, and fails with the reason if either
half goes away.
