---
"@ramonda/css": patch
---

An ordinary declaration no longer replaces an `!important` one in a merge. Both carried one key, so
the later won: `padding: 1px !important; padding-left: 2px` gave 2px where CSS gives 1px, even in one
block, and `color: red !important; color: blue` gave blue. Importance is part of a class's key now
(`r-!.pl-1px_!important`), so the two stay side by side and the `!important` layer decides, as in
CSS.
