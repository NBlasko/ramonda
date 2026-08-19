---
"@ramonda/check": patch
---

The issue-type list on `/reference/api` is now generated, and `analyze.ts` no longer re-exports
every issue shape by name.

Both were lists that held no decision, and both were conflict magnets: `analyze.ts` typed all 48
names **twice** — once to import, once to send on — and nothing in the file used a single one of
them. `export type * from "./rules"` says the same thing and cannot go stale. Two merges have now
been spent hand-resolving those lists, and one of them auto-merged into duplicate keys with no
conflict marker to show for it.

The API page's paragraph is written by `build-rule-tables.mjs`, from what the package actually
exports — not derived from rule ids, which would need a second copy of the naming exceptions the
surface test keeps, and not from `src/index.ts`, which also publishes the graph checks' shapes
(`ContextIssue` is public and is not any rule's, so a sentence beginning "every rule publishes" must
not name it).

What a new rule still touches is the registry in `src/rules/index.ts` — one list, and a real one:
the ids in it are what `Findings` is keyed by, so it cannot be discovered at runtime without losing
the literal types this package is built on.
