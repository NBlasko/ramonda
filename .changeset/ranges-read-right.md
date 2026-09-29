---
"@ramonda/css": minor
---

`animation-range` was split wrong for a range NAME: `animation-range: cover` set the end to `normal`,
and `cover 10%` read `10%` as the end. In Chromium and WebKit an end left out is the start's name, and
a length after a name is its offset — `cover 10%` runs from `cover 10%` to `cover`. It is split that
way now, and so is `timeline-trigger`, which did not split at all.

The table had been learned from lengths and checked with lengths only, so the gate never asked it a
word. It asks every family's own words now.
