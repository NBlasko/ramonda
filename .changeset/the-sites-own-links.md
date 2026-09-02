---
"@ramonda/docs": patch
---

The documentation site's own `<Link href>` values are type-checked again

`createRoutes` takes its path union from the table's KEYS, and the site built its table in a loop
over `Record<string, VNode>` — whose key type is `string`. So `AnyHref` collapsed to `string` and
every link on the largest app in the repo compiled whatever it said. Measured before the fix:
`href="/total/nonsense/not/a/route"` typechecked.

Two annotations threw it away, and the first is the one worth remembering: `export const pages:
readonly PageMeta[] = […] as const` — the `as const` had been there all along and could not help,
because the annotation beside it widened every `path` straight back. `satisfies` checks the same
shape and keeps the literals.
