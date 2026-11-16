---
"@ramonda/check": minor
---

`ramonda-check` reads a route table through every part — `createRoutes(playerRoutes, cond ? debugRoutes : undefined, { … })`: a name holding another table is followed, a condition's both arms are read. Before, only the first argument was, so a page behind a later part was judged on no route, and every feature's table was reported as handed to no outlet.

A new check, `link-to-a-conditional-route`: a `<Link>`, a `push`/`replace` or a `route()` naming a route that exists only under a condition, from code not under that same condition — the type has the route in every build. A `const` holding the condition counts as the condition, and `import.meta.env.PROD` as `!import.meta.env.DEV`.
