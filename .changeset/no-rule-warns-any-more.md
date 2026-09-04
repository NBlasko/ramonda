---
"@ramonda/check": patch
---

`--fix --dry-run` stops explaining itself with warnings that no longer exist

Its comment justified the step by saying most rules are warnings, so a normal run exits 0 on them and
only this one fails on a mechanical fault. Every rule is an error now: 87 of them, none `warn`, and
`verdict.test.ts` asserts that. So the reason had inverted while the text stood.

Re-derived and written down: fixes come only from rules, and `failingRules` takes every rule that
reported, so a finding carrying a fix already fails the plain run. As a gate over rule findings this
step is redundant with the run before it — what it still exercises, and nothing else in a gate does,
is the fixer itself against a real project.
