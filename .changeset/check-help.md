---
"@ramonda/check": minor
---

`ramonda-check` and `ramonda-check-bundle` take `--help` and `--version`. `--help` lists every option and the exit codes. An option either command does not have is refused with exit 2 — `ramonda-check` names the one a slip was meant to be — where before `ramonda-check` ignored it and `ramonda-check-bundle` read it as a path; `-x` and `--graph=file` are named too. `ramonda-check-bundle` checks a file under a folder whose name starts with `-`, which node used to read as an option. `ramonda-check` refuses a second tsconfig and a `--dry-run` without `--fix` instead of ignoring them, and exits 2, not 1, when TypeScript 7 leaves it nothing to read the project with. A path is told from an option's file by its position, and `--graph` never writes over the tsconfig the run reads — `ramonda-check tsconfig.json --graph tsconfig.json` replaced the project's config with the graph.
