---
"@ramonda/check": patch
---

The dry-run step leaves the gate, and the tests that replace it stop skipping in silence

`--fix --dry-run` was in `pnpm check` because most rules used to be warnings: a normal run exited 0
on them, so this was the only thing that failed on a fault with a mechanical answer. Every rule is an
error now — 87 of them, none `warn`, with `verdict.test.ts` asserting it — which inverts the reason
while the text stood.

Re-derived, then measured. Fixes come only from rules (`editsByFile` walks `findings` for
`issue.edit`) and `failingRules` takes every rule that reported, so a finding carrying a fix already
fails the plain run: with `class=` planted for `className=` in `apps/docs/src/Demo.tsx`, both
invocations exit 1 — the first naming the rule, the second the edit. The step cost 25-30 seconds per
run for an answer already given, and is gone.

What it left behind is coverage of the fixer itself, and that now rests entirely on
`fix-gate.test.ts`, which drives the same built CLI. Those three tests skipped themselves when
`dist/cli.js` was absent, which is right for a bare `vitest` with no build and wrong for a gate: a
change to `turbo.json` could have taken the fixer's whole coverage away while every job stayed green.
Under `CI` a missing CLI is now a failure. Measured by deleting the file — present, three pass;
missing locally, three skip; missing under `CI`, two fail and name the module they cannot find.
