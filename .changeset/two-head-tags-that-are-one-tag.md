---
"@ramonda/check": minor
---

`head-tags-collide` — two entries in one `Head` that are the same tag, so only the second is
written.

**The rule this replaced died first, and that is the point.** The backlog carried `RMD043` — a
`<meta>` with nothing to identify it — as the last runtime diagnostic that looked statically
provable. It is not: `MetaTag` is a union requiring `name`, `property` or `httpEquiv`, so `tsc`
answers `TS2769` on the tag that would trip it. Probed before anything was written, which is now the
third time a candidate has died that way.

The probe found a real one next door. `Head` keys the tags it writes by what identifies them — a
`<meta>` by `name`, `property` or `http-equiv`, a `<link>` by `rel` and `href` — so that an update
REPLACES a tag rather than appending a second copy. Two entries with one identity are therefore one
tag, and the later silently wins.

Measured end to end rather than reasoned about: ten tags written, four served. `description: "The
real one."` came back as the second description, both `robots` collapsed to `noindex`, and the
16×16 icon left no trace. No type error, no diagnostic, no way to see it in the page that is served.

`description` is a shorthand for the meta tag of that name and is collected **first**, so writing
both loses the shorthand — the line that reads like the page's own description. The report points at
the entry that is lost and names the line that replaces it. That was the second design: the first
named both entries, and printing it showed `a meta name="robots" and a meta name="robots" are both
name="robots"` — the same fact three times, and never the two lines.

What it stays quiet about: a computed identity, a spread inside a tag, a list held in a variable,
an app's own `Head` of the same name, and — the one that keeps it honest — two byte-identical
entries, which collapse to the tag they both describe and lose nothing.

Zero reports across every app and package here. Proved not to be silently dead by planting a real
collision into `DocPage`, the docs' own page component, and watching the CLI name it through the
factory spelling.
