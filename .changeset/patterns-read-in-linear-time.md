---
"@ramonda/css": patch
"@ramonda/check": patch
---

**Eight more patterns read in linear time**, found by checking every regular expression in the
repository with a ReDoS checker and measuring each one it flagged. In `@ramonda/css`: a media pair, and
both halves of a range comparison, that the runtime reads; a registered type's name, an import with a
long run of spaces, and an attribute bracket that never closes. In `@ramonda/check`: an `aria-valuenow` number and the
reason of an ignore directive. Each took 2–5 seconds on 40,000 characters, and each now takes
milliseconds.
