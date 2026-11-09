---
"@ramonda/check": minor
"@ramonda/core": patch
"@ramonda/query": patch
---

`@StableProps` crosses a package boundary. A package's published graph records what each hook and component declares a value — `Query` its `key`, `Head` its `meta` and `link` — because a `.d.ts` carries no decorators. `fresh-object-in-hook-props` now judges an installed package's hook by it, where it had been silent on every one, and `fresh-object-in-props` no longer reports an installed component's declared prop. A package that publishes no graph is left as before: nothing is said about it.
