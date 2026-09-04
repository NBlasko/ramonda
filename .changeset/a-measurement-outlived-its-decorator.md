---
"@ramonda/check": patch
---

The bundle guard's string test measures something that is still true

The test that proves the guard parses rather than greps justified itself with a measurement about
`@Host`: core's DEV diagnostics used to put `@Host("div")` and `@Host("g")` into their suggestions,
so a grep for decorator syntax would call a perfectly good bundle broken. The decorator is gone and
those messages no longer exist, which left the test passing on a reason that had stopped being one.

Re-measured on `packages/core/dist/index.js`: five occurrences of `@Name(` survive into the shipped
bundle — `@StableProps("key")` inside a fix message, `@interval("1s")` inside a comment showing what
throws. The synthetic fixture now uses names the framework still has, and a grep over it still finds
two decorators the parser correctly ignores.
