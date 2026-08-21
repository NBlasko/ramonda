---
"@ramonda/check": minor
---

`server-env-in-shared-code` finds `globalThis.process.env`, and quotes a bracketed key.

`globalThis.process.env.API_KEY` is the same `ReferenceError` on the page as `process.env.API_KEY`,
and it was silent — the check required `process` to be a bare identifier. There is deliberately no
"resolves to nothing" test on `globalThis`, unlike everywhere else in this package: the checker knows
that name whatever the lib settings are, so the test would silence every one of these. It is a
reserved binding rather than a global anyone can shadow, which is what makes leaving it off safe.
Node's `global` still takes the test.

A destructure and a bracketed key were already found, because the match is at `process.env` rather
than at the member — but `process.env["REGION"]` was quoted as `process.env`, which is less than the
reader wrote. It carries the key now. A destructure still quotes `process.env`, which is exactly
what is on the right-hand side of one.

No change to what is reported on any project in this repository.
