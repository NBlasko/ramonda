---
"@ramonda/css": minor
"create-ramonda": minor
---

**Breaking:** what only compiled code calls — `shorthands`, `pick`, `conditionsOf`, `namesOf` and
`withoutSourceMarks` — moved from `@ramonda/css` to `@ramonda/css/compiled`, and the compiler now
imports from there. On the main entry they were a second way to do what a block and a `match` already
do, and nothing checked a hand-written call. `mergeClassNames`, `read` and `toStyle` stay where they
are. A library that ships blocks compiled by an earlier version imports these from `@ramonda/css` and
must be rebuilt with this one. A `runtime` option pointing at this package's `dist/index.js` must point
at `dist/compiled.js`.
