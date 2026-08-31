---
"@ramonda/build": patch
"@ramonda/check": patch
"@ramonda/core": patch
"@ramonda/devtools": patch
"@ramonda/form": patch
"@ramonda/lens": patch
"@ramonda/query": patch
"@ramonda/router": patch
"@ramonda/server": patch
"@ramonda/testing-library": patch
"create-ramonda": patch
---

Every package's npm page carries the same four facts, and `homepage` points at its own docs

The README is published, so this is a change to what a reader lands on. Measured before it was
written: of eleven published packages, five carried no licence, three named no install command
anywhere, one had no badges, and two linked to no documentation at all. `create-ramonda` and
`@ramonda/devtools` had no README whatsoever — their npm pages were blank.

Those facts are now generated from the sources that already held them — the package name, its
`peerDependencies` (required ones appear in the install line; `bguard` is declared optional and
so does not), and `homepage`, which now points at the package's own documentation section rather
than at the site root. npm shows `homepage` beside the package, so that is a better npm page on
its own as well as the one source the README link is written from.

Nothing below the generated region changed. Each README keeps its own voice, and its own headings.
