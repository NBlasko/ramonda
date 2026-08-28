---
"@ramonda/check": minor
---

A route table is followed to the outlet that takes it, however either one was written

`<RouteOutlet routes={routes} />` with both names written out was the only arrangement the
analyzer could read. Five shapes beside it were measured on a planted fixture, and every one of
them was a report against correct code:

- the table held on a FIELD — `<RouteOutlet routes={this.table} />`
- the table taken through a LOCAL a line up
- the table handed over inside a SPREAD — `<RouteOutlet {...props} />`, long form and shorthand
- the outlet renamed — `import { RouteOutlet as Outlet }`, or
  `const { RouteOutlet: Outlet } = createRouter(routes)`, which is what a typed kit looks like
- `createRoutes` renamed — `import { createRoutes as makeRoutes }`

In each of them the tag named no table, so the table looked handed to no outlet at all: three
false `unmounted` reports on one fixture, and four pages reported dead beside them.

A declaration is now followed to its initialiser, which answers the field, the local and the
object property with one walk, and a binding is matched by the name at its SOURCE — the import
specifier's or the binding element's `propertyName` — rather than the one the file gave it. Name
and not module on purpose: a router kit is a SHAPE, so a third-party `createRouter` returning a
`RouteOutlet` is a real one, and a module test would refuse it.

A spread nothing can read now silences the whole check rather than guessing. `{...someCall()}`
may be handing over the very table about to be reported, and a checker that cannot tell a missing
outlet from an invisible one may not report either.

Measured: `apps/docs`, 155 components, 1.29 s before and 1.36 s after — the alias question is
asked of every tag. Skipping the lowercase host tags was tried and came back 1.36 s, unchanged, so
it is not in the code.
