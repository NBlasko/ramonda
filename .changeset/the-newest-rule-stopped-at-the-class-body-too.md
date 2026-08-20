---
"@ramonda/check": patch
---

`row-reads-a-plain-field` read a single class body, so a row callback inherited from a shared base —
showing a plain field declared on that base — was silent. One instance, one row, one stale value,
and nothing said so.

It was the newest rule in the package and the only one the heritage sweep had not been run against.
Planted, measured, fixed: the callback is looked up nearest-first up the chain, and the field
judgement is asked with the chain too.

**`ModuleContext` carries `resolve` now**, which is what made it possible. A module rule reads a
FILE, and the classes in it are still classes — a base's member is the component's member wherever
it is written. The alternative was one rule reaching for the type checker on its own, which is not a
shape this package has.
