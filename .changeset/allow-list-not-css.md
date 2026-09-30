---
"@ramonda/css": minor
---

`ramonda-css check` and the editor report a value in an allow-list that is not CSS, as
`allow-list-not-css`. A slot typed `"font-weight"?: "notexisting"` refused every caller while the
component that declared it said nothing; the value is now judged by the same rules as a declaration
in a block, and reported where it is written.
