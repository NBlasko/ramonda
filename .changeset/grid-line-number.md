---
"@ramonda/css": patch
---

`grid-column: 2` and `grid-row: 2` set the end line to `2`, where every engine sets it to `auto` — an
item meant to start at line 2 was squeezed to nothing. Only a line NAME is copied into the end left
out. Fixed, and line `0` and a `span` below 1 are no longer split, since every engine drops them.
