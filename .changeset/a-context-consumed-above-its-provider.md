---
"@ramonda/core": patch
"@ramonda/check": minor
---

A context consumed above its provider is reported — RMD057 at runtime, `context-consumed-above-its-provider` before anything runs.

A consumer resolves its channel ONCE, when it is constructed, and hooks are constructed in
field-declaration order. So on a component that also provides, which value the consumer reads is
decided by which of the two lines is written first. Measured on a component under an ancestor
provider: `"ancestor"` with the consumer declared first, `"mine"` with the provider declared first.
Two field declarations, and nothing said so.

**Only the consumer-first order is reported, and that is a measurement rather than a preference.**
Reporting both fired **14 times across `@ramonda/query`'s own tests** — every one of them on
`this.use(QueryClientProvider)` followed by `this.use(Query, …)`, which is mount-a-client-then-query-
on-it and the arrangement the packages are built around. Reporting only the consumer-first order fires
**nowhere in this repository**. Both directions are pinned: silencing the check fails the report test,
and reporting the other order fails the provide-then-use test.

**A warning rather than an error, in both places.** The arrangement has a legitimate reading — read
the outer value and provide a derived one, which works only in this order — as well as a mistake, a
consumer written one line too early. Nothing can tell them apart, so it says what it found and leaves
the devtools panel's alert alone.

The consumer's one-shot lookup is deliberate and is not what changed: it is what lets RMD003 report
when a consumer MOUNTS rather than on its first read, including down a branch nobody clicked.

**The rule and the diagnostic reach different cases, on purpose.** The rule speaks before anything
runs, including for a component nobody has opened, and it sees only a pair written directly — `const
[P, C] = createContext(…)` with both halves handed to `this.use` in one class, resolved through the
`BindingElement` each name came from, so an import alias is transparent and two contexts of the same
shape stay two contexts. A provider wrapped in a hook of its own, the way `QueryClientProvider` wraps
one, is invisible to it and is what the runtime diagnostic catches. Nested hooks are included there:
a hook is handed its owner's runtime, so a consumer inside a hook inside the providing component is
the same ambiguity.

**And a sentence in the documentation that this proved wrong.** `/composition/context` said the
reversed order "reads the default forever, and says so with `RMD003`". That is true only with no
provider on any ancestor; with one, it reads that ancestor's value and RMD003 does not fire — which is
the whole reason RMD057 exists. Corrected, with the way out that does not depend on the order at all:
read through the provider hook, which reads as well as publishes.
