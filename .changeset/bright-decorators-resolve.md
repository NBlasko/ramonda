---
"@ramonda/check": minor
---

A core decorator is identified by resolution, not by the name written on the member.

`hasDecorator` compared a bare name and asked nothing about where the decorator came from — the one
identity question in this package that did not resolve. Fourteen call sites across nine rules read
`@state`, `@compute`, `@persist`, `@created`, `@destroyed` and `@memoized` through it, so it failed
in both directions at once:

- **`import { state as reactive }` made every class rule go quiet.** Measured with two components
  that are the same component written twice: the plain one produced two reports and the aliased one
  produced nothing, from any rule.
- **An app's own decorator called `state` was judged as core's**, which is the shape `own-list.ts`,
  `own-head.tsx` and `own-helper.tsx` exist to keep out of three other rules.

`resolve` now carries `coreName` on itself — a callable with one property — rather than a second
function threaded beside it. `resolve` already reaches all two dozen helpers that needed this, and a
parameter a caller can forget is the shape that silenced every tree rule for a commit. Two
long-standing optional resolvers became required in the same pass: `staleFieldsOf` and
`stateFieldsOf` no longer answer a narrower question when nobody hands them one.

**It costs nothing, measured rather than assumed.** A file with 400 components: 0.58 s before,
0.58 s after. `apps/docs`, 151 components: 1.25 s before, 1.25 s after. The checker memoises symbol
lookups, and decorators are few beside everything else a run already resolves.

No change to what is reported on any project in this repository.
