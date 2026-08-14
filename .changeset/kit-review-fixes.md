---
"@ramonda/check": patch
"@ramonda/router": patch
---

A kit member whose name answers to two classes resolves to nothing, and a built href takes a
fragment.

**`@ramonda/check`** — when a package hands a component back through a factory without exporting it,
the fragment is read by name. Two exported classes sharing a name were already refused, "rather than
resolved to whichever came last"; two INTERNAL ones kept the first and said nothing. Internal names
collide far more often than exported ones — this repository's own documentation app declares
`class Page` seventy-five times — and a kit member bound to an arbitrary class puts every edge below
it under the wrong component. That is a wrong answer where an unresolved tag would have been an
honest missing one. Both are now refused and the tag reports as the hole it is.

No note is emitted for an internal collision, unlike the exported case: almost none of them is ever
reached by a destructured key, and a note per collision would bury the runs where it matters.

**`@ramonda/router`** — `AnyHref` is `Located` over both halves of the union, including the `Href`
that `route()` builds. Written out by hand, the second half took a query but not a fragment, so
`` href={`${route("/u/:id", { id })}#top`} `` was refused while `href="/about#top"` was accepted.
An anchor into a section of a parameterised page is the ordinary reason to write one; the asymmetry
was an omission, not a decision.

Two JSDoc claims that this branch had already made false are corrected — `href` no longer requires
`route()` for a `:param` path, and a raw `:param` pattern is accepted rather than rejected (a known
cost, documented three lines above where the comment denied it).

Docs: component examples import `Link` / `Navigator` from `./routes` instead of calling
`createRouter(routes)` in each file. Every app in this repository mints the kit once and imports it,
the setup page says to do exactly that, and eight examples across five pages taught the opposite —
six of them destructuring three names to use one. The sample checker now resolves `./routes` to the
real package's types, so `this.use(Navigator)` has to genuinely carry `push` and `params`; the
hand-written `any` shims those examples leaned on are gone.
