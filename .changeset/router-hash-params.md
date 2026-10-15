---
"@ramonda/router": minor
---

The hash is read the way the query is. `nav.hashParams` is `#a=1&b=2` → `{ a: "1", b: "2" }`, `updateHashParams` changes it, and `HashParamsUpdater` is its type — replacing `hashTags`, `updateHashTags`, `HashTag` and `HashTagsUpdater`, whose hash was split on `#` with one pair per segment: `#access_token=…&state=…`, the shape an OAuth redirect hands back, kept the first pair and dropped the rest without a word.

A bare `#install` is `{ install: "" }`, the name of a section, and is written back bare. A component re-renders on a hash change only if it reads `hashParams`, as with `searchParams`.

To move: `nav.hashTags.find((t) => t.key === "tab")?.value` is `nav.hashParams.tab`; `updateHashTags([{ key: "tab", value: "film", level: 0 }])` is `updateHashParams({ tab: "film" })`; a URL written `#a=1#b=2` is `#a=1&b=2`.
