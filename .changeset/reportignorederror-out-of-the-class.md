---
"@ramonda/query": patch
---

RMQ002's reporter no longer reaches the production build.

Reported by Nikola, and true — `dist/index.prod.js` contained `reportIgnoredError(){}`. The body, the
message and the string `RMQ002` were all stripped by `__DEV__`; the declaration was left standing,
because **a class method cannot be tree-shaken** — nothing can prove it unused. It is a module function
now, referenced only inside `if (__DEV__)`, which a bundler drops whole. That is how every other
diagnostic in this repo is written, and now there is a reason written down for why.

The worse half was its DEV-only `@mount`. A lifecycle decorator registers from an initializer, so in
production **every `Query` instance** allocated an id, bound the empty method, pushed an entry onto the
runtime's mounts, and the flush then called it — per instance, for a method that did nothing. The
restored-error case reports from the top of `load` instead, an `@mount` that exists in every build, and
it is unaffected by being earlier: a refetch moves `fetchStatus`, not `status`, so a restored failure is
still there to see.

Both names are in the production-build test's forbidden list now, and putting the method back fails it.
