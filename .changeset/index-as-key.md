---
"@ramonda/check": minor
---

A new rule: `index-as-key`.

`key={i}` is not an identity — it is the position, which is what the diff matched rows by before any
key was written. So it changes nothing about how rows are found again, and it costs something
specific: it silences `row-without-a-key`, and it reads to the next person as a decision somebody
made.

What it hides shows the moment the list is not append-only. Delete the first of ten rows and every
row below keeps the key it used to have, so row 2's DOM is matched to row 1's data — a half-typed
input, an open menu, a checked box, all one row off, and the page still looks right.

Reported only when every name the key is built from is the callback's index parameter: `key={i}`,
`key={String(i)}`, `` key={`row-${i}`} ``, `key={i + 1}`. A key that also carries something from the
row — `` key={`${row.id}-${i}`} `` — is a real identity and is left alone.

Only `.map` and `.flatMap` are looked at, because `list()` hands its callback one argument: there is
no index there to reach for, which is the point of it.
