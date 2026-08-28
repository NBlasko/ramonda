---
"@ramonda/core": minor
---

A boolean attribute is written the way HTML spells it

`disabled`, `checked`, `selected`, `muted` and the rest of the HTML boolean attributes are written
as the empty string when they are on, rather than as `="true"`. A browser reads only whether a
boolean attribute is PRESENT, so nothing behaved differently — but the word sat in every served
page for nothing to read, and the markup did not round-trip: the same element read back through
`outerHTML` says `disabled=""`.

Keyed on the attribute name, so `aria-hidden={true}` still writes `"true"` and a `data-*` flag
keeps its word. ARIA states are enumerated strings rather than boolean attributes, and a data
attribute's value is data that something reads back.
