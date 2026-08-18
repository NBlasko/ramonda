---
"@ramonda/check": patch
---

`@ramonda/check` guards its own public surface, and three types that were never exported now are.

This package had no `PublicSurface.test.ts` and no line in the docs' `check-api-coverage.mjs`, so
neither of the two tripwires every other package has was watching it. In that time it went from five
rules to twenty-seven, each one adding a published issue type — and **`AriaValueIssue`,
`RoleMissingRequiredAriaIssue` and `RoleTakesNoNameIssue` were never exported at all**. They were
reachable through `findings` and unnameable in an annotation, which makes the documented way to use
this package — write a script against `analyzeProject` — impossible for three of its rules.

Nothing noticed, because nothing was looking. That is the entire argument for both files.

The surface test asserts what the entry exports and what it publishes as types, and adds a third
check the others do not have: **every rule in the registry has an exported issue type**, derived
from the rule's own id rather than from a second list. A rule added tomorrow brings its type with
it, and the four spellings where the type is not the id in PascalCase are listed beside their
reason.

It also asserts what is NOT reachable. `RULES`, the per-family registries and the `apply*` functions
stay internal: a rule carries functions over its own issue type and a `read` that takes a compiler
node, so publishing one would make this package's internals somebody's dependency and every change
to a rule's shape a breaking change. `ruleCatalogue()` is what a caller actually wants from them.

`/reference/api` gains a `@ramonda/check` section, and the docs build now fails when an export is
missing from it. Proved by deleting the section and watching the build name what went.
