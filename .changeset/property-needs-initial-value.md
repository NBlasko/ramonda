---
"@ramonda/css": patch
---

`@@property` with no `initial-value` is reported, unless its `syntax` is `"*"`. Every browser drops
such a registration whole, so the property was silently unregistered.
