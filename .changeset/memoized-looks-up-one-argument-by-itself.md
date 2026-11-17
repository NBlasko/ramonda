---
"@ramonda/core": patch
---

`@memoized` finds a handler for one argument by that argument

A call with one string, number or boolean — `this.select(row.id)`, once per row per render — is looked
up by the value itself; a call with any other arguments keeps its built key, in a table of its own.
Measured beside the previous build on js-framework-benchmark, median script time: selecting a row went
from 104.6 to 97.4 ms and creating 10,000 rows from 384.3 to 367.4 ms.
