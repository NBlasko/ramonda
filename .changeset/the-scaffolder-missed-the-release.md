---
"create-ramonda": minor
---

A new project scaffolds against the versions that are actually published

`create-ramonda` was not in the last release, and its version ranges are baked at
BUILD time — `tsup.config.ts` reads each package's version off the workspace and
writes `~<version>` into the CLI. So the ranges a published scaffolder hands out
are the ones that were on disk when that scaffolder was built, and they only move
when it is published again.

It was not, so they did not. `create-ramonda@0.12.4` was built for an earlier
release, when `@ramonda/check` was still `0.13.0`, and comparing the ranges it
carries against what is published now, **five of its ten first-party pins are
behind**:

| package | the scaffolder hands out | published |
| --- | --- | --- |
| `@ramonda/check` | `~0.13.0` | `0.14.0` |
| `@ramonda/core` | `~0.23.1` | `0.24.0` |
| `@ramonda/lens` | `~0.3.2` | `0.4.0` |
| `@ramonda/query` | `~0.9.2` | `0.10.0` |
| `@ramonda/router` | `~0.11.0` | `0.12.0` |

A tilde on a `0.x` line pins the minor, so `~0.13.0` is `>=0.13.0 <0.14.0` and
never reaches `0.14.0`. The one that matters most is the first: a project created
today gets the checker **where rules are warnings**, from the release whose
headline is that every rule fails the run. The documentation says a rule refuses;
the project you just scaffolded prints and passes, and nothing anywhere explains
the difference.

**The release gate cannot catch this, and that is deliberate rather than a bug.**
`verify-versions` checks the scaffolder's first-party ranges against the
WORKSPACE rather than against the registry, because those packages publish in the
same run and a registry check would race them. By then the workspace is bumped
and rebuilt, so the ranges agree. What it proves is that the built scaffolder is
correct — not that the built scaffolder is the one on npm.

**So the check that does catch it is a person's:** on every release, before
publishing, confirm `create-ramonda` is in the list of packages about to be
bumped. `pnpm changeset status` prints it.

A minor rather than a patch: what a scaffolded project is made of changes, across
five packages, and two of them changed behaviour.
