---
"@ramonda/devtools": patch
---

Two fixes in the panel, one of them a crash on every poll.

**`refreshAges` threw four times a second.** A query's hash is built from its key, so it carries
quotes and brackets — `0:["products"]` — and interpolating that into `[data-q-age="…"]` produces
a selector the parser rejects (`Failed to execute 'querySelector': not a valid selector`). The
elements are collected once and matched through `dataset` in JS now, where there is no selector
grammar to offend.

**A value is capped at 8000 characters instead of 200.** 200 was chosen when a value was rendered
on one clipped line, and it is why a props block read
`{"entries":{},"defaults":{"staleTime":0,…` and stopped exactly where the interesting part began.
Values scroll inside their own box now, so the cap only has to keep a pathological blob off the
wire.
