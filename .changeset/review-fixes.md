---
"@ramonda/css": patch
---

- `container-name-not-set` advises `container: <name> / inline-size`: a name alone never answers a size condition, in any engine.
- The editor no longer stalls on a value of long whitespace: a hover over one took a minute for 5000 spaces, and `invalid-value` grew with the square of them. A long list — twenty `background` layers — is answered in tens of milliseconds, not over half a second.
