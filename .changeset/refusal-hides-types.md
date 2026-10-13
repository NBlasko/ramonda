---
"@ramonda/css": patch
---

One block that could not be read no longer hides type errors in every other file. `ramonda-css` skipped the whole type check on any refusal, so a fault only the types see — `position: absolutex` — compiled clean anywhere beside it. Only the refused file is left out now.
