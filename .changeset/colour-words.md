---
"@ramonda/css": minor
---

A project that takes colours only from its tokens writes `transparent` and `currentColor` as they are, in the editor and in the build: neither is a colour picked off a palette. `currentColor` as well as `currentcolor`, since CSS keywords ignore case. `em` is still a length like any other.
