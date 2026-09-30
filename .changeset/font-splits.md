---
"@ramonda/css": minor
---

`font` now splits into its longhands, and writes out every longhand it resets — most of them are
inherited, so one left out would take the parent's value where `font` gives the initial one. A system
font (`caption`, `menu`) keeps the shorthand: what it sets is the platform's.
