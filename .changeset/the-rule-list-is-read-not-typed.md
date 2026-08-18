---
"@ramonda/check": minor
---

The reference's rule tables are generated from the rules, and `ruleCatalogue()` is what generates
them.

**The fault it fixes was already there and already silent.** The check reference carried two tables
of rules — errors and warnings — typed by hand, and the day nine rules landed beside them the tables
were nine rows short. Nothing noticed, because nothing connected the two. A reference that is
quietly incomplete is worse than one that says so: a rule missing from the page is a rule nobody
knows they are being judged by.

`Report` now carries the two facts a table needs and a rule did not say out loud:

- **`reportedWhen`** — the condition, as a clause completing "reported when". Beside the rule it
  describes, which is the only place where changing one makes the other obviously stale.
- **`alsoReportedAs`** — the runtime diagnostic that reports the same fault once the line runs, for
  the six rules that have one. A code rather than a link, so nothing in the package has to know what
  the documentation site is built with.

**`ruleCatalogue()`** is the new export: every rule as four strings, in the order their reports are
printed. Deliberately not the rules themselves — a rule carries functions over its own issue type,
which is no use to a generator and would tie anything touching it to this package's internals.

`apps/docs` builds both tables from it and the docs build fails when the committed page does not
match, the same shape `build-theme.mjs --check` already had. Four failure modes, each planted and
watched: a stale table, a missing region, a rule naming a diagnostic the reference does not
document, and — the one a generator usually gets wrong — the region markers themselves. They are
link reference definitions rather than HTML comments, because the site renders markdown with
`html: false`, so a comment arrives at the reader as `<!-- … -->`. Measured, not assumed.
