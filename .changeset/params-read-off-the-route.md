---
"@ramonda/check": minor
---

`params(pattern)` read where no route matched

`nav.params("/users/:id")` is a claim about which route a component is standing on. The router
already refuses it at runtime — `assertPattern` throws in every build, naming both the pattern
asked for and the route actually matched. This says it before anything renders, on every
arrangement the source can produce, including the branch nobody clicked.

**Neither of the two things that look like they should catch it can.**

The types check the pattern against the paths your TABLE declares — `params<Pat extends
ParamPath<C>>` — never against the route this component is under. Measured on
`apps/playground-ssr`: a page mounted at `/users/:id` reading `params("/guide/:slug")` compiles
without complaint, because both are real paths in that table.

The context checks cannot either, and this is the more interesting half. The params context is
declared `optional` on purpose: `{}` is a REAL answer for a nav bar, a header or a footer beside the
outlet, and `Navigator` holds that consumer for everyone — so reporting the missing provider would
accuse the exact arrangement the router documents. The fault is which METHOD is called, not which
context is consumed, and no rule about contexts can draw that line.

**What it will not claim.** A component reported here is one that no arrangement puts under an
outlet. One rendered both beside the outlet and inside a routed page is silent — it is correct on a
path it is mounted on, which is why the answer travels with the PATH rather than living on the
class. `params()` with no argument is never judged: it names no pattern and claims no route, which
is the documented door for a component written against no one route. A pattern that is not a
literal is skipped, because what it claims cannot be quoted back to the reader.

Three silences make it safe to fail a build on: no root (a library has no arrangement to judge), an
outlet that spreads props this cannot read (it may be handing over any table in the program), and a
component no root reaches at all (that is the unreachable-declaration finding, and its fix is to
mount the component, not to move the read).

The navigator is identified through the router's own `knownAs`, so a kit member destructured out of
`createRouter` and an import under another name are both read — measured on the real SSR playground,
where `Navigator` arrives through the kit.
