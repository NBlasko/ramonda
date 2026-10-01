---
"@ramonda/css": patch
---

`position-try` splits a fallback of several words: `--a, top left`, `--a, flip-block flip-inline`,
`--b flip-block`. The rule follows what the engines take — all three refuse `x-self-start` and its
kin, and all three take `flip-x` and `flip-y`.
