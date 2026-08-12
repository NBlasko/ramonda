---
"@ramonda/check": minor
---

A component is a declaration, not a name.

Components were held in a map keyed by class NAME, so two classes with one name were one node
sharing a single set of providers, consumers and children. This repository's own documentation app
declares `class Page` seventy-five times, one per page: 146 component and hook classes were counted
and reported as 72, and a provider mounted by one page covered every other page on every path.

Identity is the declaration site now, and everything that names a component — a JSX tag,
`list({ as })`, a route table, `bootstrap` — is resolved to its symbol rather than looked up by
name. An import alias therefore reaches the class it renames: `import { Page as Themed }` followed
by `<Themed />` is an edge, where a name lookup found nothing at all and the walk stopped there.

The counts the CLI prints move with it — the docs app reports 146 components rather than 72 — and
the four apps in this repository report the same issues as before.
