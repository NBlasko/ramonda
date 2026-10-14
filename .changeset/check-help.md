---
"@ramonda/check": minor
---

`ramonda-check` and `ramonda-check-bundle` take `--help` and `--version`. `--help` lists every option and the exit codes. An option either command does not have is refused with exit 2 — `ramonda-check` names the one a slip was meant to be — where before `ramonda-check` ignored it and `ramonda-check-bundle` read it as a path; `-x` and `--graph=file` are named too. `ramonda-check-bundle` checks a file under a folder whose name starts with `-`, which node used to read as an option.
