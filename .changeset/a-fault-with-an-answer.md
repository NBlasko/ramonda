---
"@ramonda/check": minor
---

`--fix --dry-run` answers with its exit code, so a gate can use it

It is the shape `biome format --check` and every tool like it uses: nothing is written, and the exit
code says whether anything would be. `1` means there is a fault here whose answer this package
already knows.

That is what makes `--fix` usable in a gate, and the repository now runs it as its own step. A
warning is a judgement somebody may reasonably defer, which is why a normal run exits `0` on one. A
warning with a MECHANICAL answer is not that — there is no version of "later" that improves
`class` instead of `className`.

The step is separate rather than folded into the existing run, and it stops rather than falling
through to the report: one question, one answer. A step that also printed every unrelated warning
would be read as the whole check, and it is not.

Proved against the project the gate actually checks, rather than a fixture: planting one `class` in
`apps/docs` made the step exit `1` and name the file, `--fix` returned that file byte-identical to
what it was, and the step went back to `0`. Its exit codes are pinned by a test that runs the built
CLI as a process, because a gate step that silently stopped failing would be worse than no step.
