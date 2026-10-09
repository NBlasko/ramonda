---
"@ramonda/css": minor
---

**`hardcoded` is judged per value, and the report names the token that already holds it.** A property
taking a length or a percentage was judged as one: `"<percentage>": { hardcoded: true }` beside a locked
`<length>` let `width: 12px` through too — measured — and the type, merged the same way, could be
stricter than the rule on the same line. Each value is asked about its own kind now, in the rule and
in the type alike, so percentages can be set free while lengths stay tokens. And `12px` where
`$space.m` is `12px` says to write `$space.m` — or the token whose `light-dark()` pair holds a colour
written out. Minor, because a config relying on the old merge can now refuse a length it let through.
