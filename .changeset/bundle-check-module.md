---
"@ramonda/check": minor
"@ramonda/build": minor
---

`ramonda-check-bundle` stops calling a correct build broken, and both packages declare Node 24.

A `.js` file is a script or a module depending on the nearest `package.json`, and a bundler emits ES
modules into `dist` whatever that file declares — so `"type": "commonjs"` beside ESM output is an
ordinary arrangement. Read as a script, such a bundle "does not parse", and this tool reported it as
the one fault it exists to find:

```
[check-bundle] 1 of 1 emitted file(s) do not parse:
    SyntaxError: Cannot use import statement outside a module
If these contain decorators, the build is not running a transform that strips them.
```

Nothing was wrong with the build. The guard failed it anyway, and named the wrong cause while doing
so. Every project in this repository sets `"type": "module"`, which is the only reason this was
never seen here.

A file that fails to parse as a script, **and fails with one of the four messages that mean
module-only syntax**, is now parsed again as a module. The second parse never runs otherwise, so a
decorator still fails both ways and no failure is downgraded — there is a test for exactly that,
because a retry that accepted anything would buy the false pass back at full price.

**Breaking:** both packages now declare `"engines": { "node": ">=24" }`, matching the repository
root and `create-ramonda`. `pnpm` refuses an install that violates `engines` rather than warning, so
this is a floor and not advice.

The floor is a choice about the future, not a measurement: `node --check` reads ESM in an untyped
`.js` on 20.19 and on 22.7+, but **not on 22.0 through 22.6**, where module detection had not landed
yet — a range that is not monotone, so `>=20.19` would have been a wrong description of it. Rather
than encode that shape, the supported version is the one that will be current by the time anyone
adopts this. The parse fix stands on its own regardless: `npm` only warns on `engines`, so the floor
alone would have left the false accusation reachable.
