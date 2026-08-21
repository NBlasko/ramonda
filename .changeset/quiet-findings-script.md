---
"@ramonda/check": patch
---

`scripts/findings-across-fixtures.mjs` — every finding across every fixture, recorded or compared.

Reviewing a branch of rule changes has one question a diff cannot answer and a test suite answers
only where somebody thought to assert it: **what stopped being reported?** A new finding is visible;
a lost one is invisible by definition, because a rule that reports nothing looks exactly like a
clean codebase.

`pnpm --filter @ramonda/check findings --write baseline.txt` on `main`, `--against baseline.txt` on
the branch. It exits non-zero on a loss and names each one. No network, no model, no judgement — it
runs the analyzer over all ~80 fixtures and prints the set difference.

Proved to catch what it is for by sabotaging `access-key` into silence: four claims vanished across
two fixtures and all four were named. It found two real things on the branch that added it — a
fixture carrying a context-order fault it was not about, and a namespace import of core that had
never been recognised.
